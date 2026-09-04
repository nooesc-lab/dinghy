import { db } from "@dokploy/server/db";
import {
	execAsync,
	execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { IS_CLOUD } from "../constants";

export const FLEET_POLL_MS = 5000;
export const FLEET_MAX_SAMPLES = 720; // 1h at 5s
const HOST_TIMEOUT_MS = 10_000;
export const LOCAL_HOST_KEY = "local";

export interface FleetSample {
	t: number;
	cpuPercent: number | null;
	loadAvg1: number | null;
	memUsedBytes: number;
	memTotalBytes: number;
	diskUsedBytes: number | null;
	diskTotalBytes: number | null;
	uptimeSec: number | null;
	cpuCount: number;
	containerCount: number;
}

export type FleetHostStatus = "ok" | "unreachable" | "pending";

export interface FleetHostMeta {
	hostKey: string;
	serverId: string | null;
	name: string;
	aliases: string[];
	ipAddress: string | null;
	/** Every organization that registered this ip:port; used by the router for org scoping. */
	organizationIds: string[];
}

export interface FleetHostState {
	meta: FleetHostMeta;
	status: FleetHostStatus;
	error: string | null;
	latest: FleetSample | null;
	samples: FleetSample[];
}

interface RawVitals {
	cpuPercent?: number | string | null;
	loadAvg1?: number | string | null;
	memUsedBytes?: number | string | null;
	memTotalBytes?: number | string | null;
	diskUsedBytes?: number | string | null;
	diskTotalBytes?: number | string | null;
	uptimeSec?: number | string | null;
	cpuCount?: number | string | null;
	containerCount?: number | string | null;
}

// Vitals only: one exec round-trip, every probe falls back to `null` on its own.
// CPU is the busy share between two /proc/stat reads 200ms apart.
const VITALS_SCRIPT = `
jsonNum() { case "$1" in ''|.*|*.|*[!0-9.]*|*.*.*) echo null;; *) echo "$1";; esac; }
cpuStat1=$(grep '^cpu ' /proc/stat 2>/dev/null)
sleep 0.2 2>/dev/null || sleep 1
cpuStat2=$(grep '^cpu ' /proc/stat 2>/dev/null)
cpuPercent=$(printf '%s\\n%s\\n' "$cpuStat1" "$cpuStat2" | awk 'NF>=5{i=$5+$6; t=0; for(k=2;k<=9&&k<=NF;k++)t+=$k; if(NR==1){i1=i;t1=t;s1=1} if(NR==2){i2=i;t2=t;s2=1}} END{dt=t2-t1; if(s1&&s2&&dt>0){p=(1-(i2-i1)/dt)*100; if(p<0)p=0; if(p>100)p=100; printf "%.1f", p}}')
loadAvg1=$(awk '{print $1}' /proc/loadavg 2>/dev/null)
memTotalBytes=$(awk '/^MemTotal:/{printf "%.0f", $2*1024}' /proc/meminfo 2>/dev/null)
memUsedBytes=$(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{if(t>0&&a!="")printf "%.0f", (t-a)*1024}' /proc/meminfo 2>/dev/null)
diskTotalBytes=$(df -B1 -P / 2>/dev/null | awk 'NR==2{print $2}')
diskUsedBytes=$(df -B1 -P / 2>/dev/null | awk 'NR==2{print $3}')
uptimeSec=$(awk '{printf "%d", $1}' /proc/uptime 2>/dev/null)
cpuCount=$(nproc 2>/dev/null)
containerCount=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')
printf '{"cpuPercent":%s,"loadAvg1":%s,"memUsedBytes":%s,"memTotalBytes":%s,"diskUsedBytes":%s,"diskTotalBytes":%s,"uptimeSec":%s,"cpuCount":%s,"containerCount":%s}' "$(jsonNum "$cpuPercent")" "$(jsonNum "$loadAvg1")" "$(jsonNum "$memUsedBytes")" "$(jsonNum "$memTotalBytes")" "$(jsonNum "$diskUsedBytes")" "$(jsonNum "$diskTotalBytes")" "$(jsonNum "$uptimeSec")" "$(jsonNum "$cpuCount")" "$(jsonNum "$containerCount")"
`;

const toInt = (value: unknown): number => {
	const n = Number.parseInt(String(value ?? "0"), 10);
	return Number.isFinite(n) ? n : 0;
};

const toNullableNumber = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
};

const parseSample = (stdout: string): FleetSample => {
	const raw = JSON.parse(stdout.trim()) as RawVitals;
	return {
		t: Date.now(),
		cpuPercent: toNullableNumber(raw.cpuPercent),
		loadAvg1: toNullableNumber(raw.loadAvg1),
		memUsedBytes: toInt(raw.memUsedBytes),
		memTotalBytes: toInt(raw.memTotalBytes),
		diskUsedBytes: toNullableNumber(raw.diskUsedBytes),
		diskTotalBytes: toNullableNumber(raw.diskTotalBytes),
		uptimeSec: toNullableNumber(raw.uptimeSec),
		cpuCount: toInt(raw.cpuCount),
		containerCount: toInt(raw.containerCount),
	};
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Timed out after ${ms / 1000}s`)),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});

interface SamplerStore {
	hosts: Map<string, FleetHostState>;
	inFlight: Set<string>;
	timer: NodeJS.Timeout | null;
	ticking: boolean;
}

// Next bundles its own copy of @dokploy/server for API routes (transpilePackages),
// so plain module state would be duplicated: the sampler fills one Map while the
// tRPC router reads another. Anchor the store on globalThis to share one instance
// across every bundle in this process.
const STORE_KEY = Symbol.for("dinghy.fleet-sampler");
const store: SamplerStore = ((globalThis as Record<symbol, unknown>)[
	STORE_KEY
] ??= {
	hosts: new Map<string, FleetHostState>(),
	inFlight: new Set<string>(),
	timer: null,
	ticking: false,
} satisfies SamplerStore) as SamplerStore;
const { hosts, inFlight } = store;

/** Dedupes registrations by ip:port; the earliest-created one is polled, later ones become aliases. */
const loadHostMetas = async (): Promise<FleetHostMeta[]> => {
	const metas: FleetHostMeta[] = [];
	if (!IS_CLOUD) {
		metas.push({
			hostKey: LOCAL_HOST_KEY,
			serverId: null,
			name: "Dinghy",
			aliases: [],
			ipAddress: null,
			organizationIds: [],
		});
	}

	const servers = await db.query.server.findMany({
		columns: {
			serverId: true,
			name: true,
			ipAddress: true,
			port: true,
			organizationId: true,
			createdAt: true,
		},
	});
	servers.sort((a, b) =>
		a.createdAt === b.createdAt
			? a.serverId.localeCompare(b.serverId)
			: a.createdAt < b.createdAt
				? -1
				: 1,
	);

	const byEndpoint = new Map<string, FleetHostMeta>();
	for (const s of servers) {
		const endpoint = `${s.ipAddress}:${s.port}`;
		const existing = byEndpoint.get(endpoint);
		if (existing) {
			if (s.name !== existing.name && !existing.aliases.includes(s.name)) {
				existing.aliases.push(s.name);
			}
			if (!existing.organizationIds.includes(s.organizationId)) {
				existing.organizationIds.push(s.organizationId);
			}
			continue;
		}
		const meta: FleetHostMeta = {
			hostKey: s.serverId,
			serverId: s.serverId,
			name: s.name,
			aliases: [],
			ipAddress: s.ipAddress,
			organizationIds: [s.organizationId],
		};
		byEndpoint.set(endpoint, meta);
		metas.push(meta);
	}
	return metas;
};

const pollHost = async (state: FleetHostState) => {
	const { hostKey, serverId } = state.meta;
	if (inFlight.has(hostKey)) return;
	inFlight.add(hostKey);
	const exec = serverId
		? execAsyncRemote(serverId, VITALS_SCRIPT)
		: execAsync(VITALS_SCRIPT);
	// A hung SSH session must not pin the host; the guard above keeps at most one exec per host alive.
	exec.finally(() => inFlight.delete(hostKey)).catch(() => {});
	try {
		const { stdout } = await withTimeout(exec, HOST_TIMEOUT_MS);
		const sample = parseSample(stdout);
		state.samples.push(sample);
		if (state.samples.length > FLEET_MAX_SAMPLES) {
			state.samples.splice(0, state.samples.length - FLEET_MAX_SAMPLES);
		}
		state.latest = sample;
		state.status = "ok";
		state.error = null;
	} catch (error) {
		state.status = "unreachable";
		state.error =
			error instanceof Error ? error.message : "Could not read host vitals";
	}
};

const tick = async () => {
	if (store.ticking) return;
	store.ticking = true;
	try {
		const metas = await loadHostMetas();
		const seen = new Set<string>();
		for (const meta of metas) {
			seen.add(meta.hostKey);
			const state = hosts.get(meta.hostKey);
			if (state) {
				state.meta = meta;
			} else {
				hosts.set(meta.hostKey, {
					meta,
					status: "pending",
					error: null,
					latest: null,
					samples: [],
				});
			}
		}
		for (const hostKey of hosts.keys()) {
			if (!seen.has(hostKey)) hosts.delete(hostKey);
		}
		// Fire and forget: a slow host only delays itself, the next tick still starts on time.
		for (const state of hosts.values()) {
			void pollHost(state);
		}
	} catch (error) {
		console.error("Fleet sampler tick failed", error);
	} finally {
		store.ticking = false;
	}
};

/** Starts the in-process sampler (idempotent). First tick runs immediately. */
export const startFleetSampler = () => {
	if (store.timer) return;
	store.timer = setInterval(() => void tick(), FLEET_POLL_MS);
	store.timer.unref?.();
	void tick();
};

export const stopFleetSampler = () => {
	if (!store.timer) return;
	clearInterval(store.timer);
	store.timer = null;
};

/** Live view of every sampled host keyed by hostKey ("local" or the polled serverId). */
export const getFleetSnapshot = (): ReadonlyMap<string, FleetHostState> => hosts;
