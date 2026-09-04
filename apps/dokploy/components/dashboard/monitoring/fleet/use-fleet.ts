import type { ServerHealthResult } from "@dokploy/server/services/server-health";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartConfig } from "@/components/dither-kit";
import { api } from "@/utils/api";
import { type HostColor, hostColorAt } from "./palette";

export const GIB = 1024 ** 3;
export const POLL_MS = 15_000;
/** 40 samples × 15s ≈ 10 minutes of history, kept client-side only. */
export const MAX_SAMPLES = 40;
/** After the first host answers in a poll cycle, wait this long for the rest before snapshotting a row. */
const SETTLE_MS = 2_000;

export const LOCAL_HOST_KEY = "local";

export interface FleetHost {
	/** `${ipAddress}:${port}`, or `local` for the Dinghy host */
	key: string;
	/** Absent for the local host */
	serverId?: string;
	name: string;
	ip: string;
	/** Other registrations pointing at the same endpoint (deduped away) */
	aliases: string[];
	color: HostColor;
}

export type HostStatus =
	| { state: "checking" }
	| { state: "online"; data: ServerHealthResult }
	| { state: "unreachable"; error: string };

export type FleetHostView = FleetHost & { status: HostStatus };

/** One host's reading at a snapshot. Only present when the host answered. */
export interface HostReading {
	cpu: number | null;
	/** memUsed / memTotal, 0–100; null when the total is unknown */
	memPct: number | null;
	memUsedGiB: number;
	memTotalGiB: number;
	containers: number;
}

export interface FleetSample {
	t: number;
	readings: Record<string, HostReading>;
}

/** A chart row: the formatted time plus one numeric column per host key. */
export type SeriesRow = Record<string, number | string>;

interface RegisteredServer {
	serverId: string;
	name: string;
	ipAddress: string;
	port: number;
	createdAt: string;
}

// One row per unique SSH endpoint; extra registrations become aliases. Sorted
// by registration so palette slots stay put when a new server is added.
const buildHosts = (servers: RegisteredServer[]): FleetHost[] => {
	const byKey = new Map<string, FleetHost>();
	const ordered = [...servers].sort((a, b) =>
		a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
	);
	for (const server of ordered) {
		const key = `${server.ipAddress}:${server.port}`;
		const host = byKey.get(key);
		if (host) {
			host.aliases.push(server.name);
		} else {
			byKey.set(key, {
				key,
				serverId: server.serverId,
				name: server.name,
				ip: server.ipAddress,
				aliases: [],
				color: hostColorAt(byKey.size + 1),
			});
		}
	}
	return [
		{
			key: LOCAL_HOST_KEY,
			name: "Local",
			ip: "Dinghy host",
			aliases: [],
			color: hostColorAt(0),
		},
		...byKey.values(),
	];
};

const readingOf = ({ vitals, containers }: ServerHealthResult): HostReading => ({
	cpu: vitals.cpuPercent,
	memPct:
		vitals.memTotalBytes > 0
			? (vitals.memUsedBytes / vitals.memTotalBytes) * 100
			: null,
	memUsedGiB: vitals.memUsedBytes / GIB,
	memTotalGiB: vitals.memTotalBytes / GIB,
	containers: containers.containerCount,
});

interface Aggregate {
	containers: number;
	/** Mean of the hosts that report CPU; null until one does */
	cpuAvg: number | null;
	memUsedGiB: number;
	memTotalGiB: number;
}

const aggregate = (readings: HostReading[]): Aggregate => {
	const cpus = readings
		.map((r) => r.cpu)
		.filter((c): c is number => c !== null);
	return {
		containers: readings.reduce((sum, r) => sum + r.containers, 0),
		cpuAvg:
			cpus.length === 0
				? null
				: cpus.reduce((sum, c) => sum + c, 0) / cpus.length,
		memUsedGiB: readings.reduce((sum, r) => sum + r.memUsedGiB, 0),
		memTotalGiB: readings.reduce((sum, r) => sum + r.memTotalGiB, 0),
	};
};

export interface FleetSummary extends Aggregate {
	online: number;
	total: number;
	/** One value per sample, for the tile sparklines */
	history: {
		online: number[];
		containers: number[];
		cpuAvg: number[];
		memUsedGiB: number[];
	};
}

export interface Fleet {
	hosts: FleetHostView[];
	samples: FleetSample[];
	/** `live · last 4 min`, or a collecting hint before two samples exist */
	windowLabel: string;
	summary: FleetSummary;
	/** Hosts with at least one reading in the window — the chart series */
	chartHosts: FleetHostView[];
	chartConfig: ChartConfig;
	cpuRows: SeriesRow[];
	memRows: SeriesRow[];
}

/**
 * Polls every deduped host on the same cadence and folds their readings into
 * one shared, time-aligned sample list so all hosts can share a chart.
 *
 * Hosts answer at slightly different moments within a cycle, so instead of
 * bucketing per-host timestamps we snapshot: the first answer of a cycle arms a
 * short settle timer, then one row is taken holding every host's latest
 * reading. Unreachable hosts simply have no reading in that row.
 */
export const useFleet = (): Fleet => {
	const { data: servers } = api.server.all.useQuery();
	const hosts = useMemo(() => buildHosts(servers ?? []), [servers]);

	const results = api.useQueries((t) =>
		hosts.map((host) =>
			t.docker.getServerHealth(
				host.serverId ? { serverId: host.serverId } : {},
				{
					refetchInterval: POLL_MS,
					retry: false,
					refetchOnWindowFocus: false,
				},
			),
		),
	);

	const views: FleetHostView[] = hosts.map((host, i) => {
		const result = results[i];
		const failure = result?.error?.message ?? result?.data?.error;
		const status: HostStatus = failure
			? { state: "unreachable", error: failure }
			: result?.data
				? { state: "online", data: result.data }
				: { state: "checking" };
		return { ...host, status };
	});

	// Latest reading per host, read by the snapshot timer through a ref so the
	// timer never closes over a stale render.
	const latest: Record<string, HostReading> = {};
	for (const view of views) {
		if (view.status.state === "online") {
			latest[view.key] = readingOf(view.status.data);
		}
	}
	const latestRef = useRef(latest);
	useEffect(() => {
		latestRef.current = latest;
	});

	const [samples, setSamples] = useState<FleetSample[]>([]);
	const lastRowAt = useRef(0);
	const timer = useRef<number | null>(null);

	const snapshot = useCallback(() => {
		const t = Date.now();
		lastRowAt.current = t;
		const sample: FleetSample = { t, readings: latestRef.current };
		setSamples((prev) => {
			const next =
				prev.length >= MAX_SAMPLES
					? prev.slice(prev.length - MAX_SAMPLES + 1)
					: prev.slice();
			next.push(sample);
			return next;
		});
	}, []);

	// Changes whenever any host answers (success or failure). The first row
	// also waits for the server list, so remotes don't enter the window a row
	// late and start their series from zero.
	const updateSig = results
		.map((r) => `${r.dataUpdatedAt}:${r.errorUpdatedAt}`)
		.join("|");
	const anySettled = servers !== undefined && results.some((r) => r.isFetched);
	const allSettled = results.length > 0 && results.every((r) => r.isFetched);
	const hasRows = samples.length > 0;

	useEffect(() => {
		if (timer.current !== null || !anySettled) return;
		if (hasRows && Date.now() - lastRowAt.current < POLL_MS * 0.6) return;
		const delay = !hasRows && allSettled ? 0 : SETTLE_MS;
		timer.current = window.setTimeout(() => {
			timer.current = null;
			snapshot();
		}, delay);
	}, [updateSig, anySettled, allSettled, hasRows, snapshot]);

	// Unmount only (StrictMode replays it): clear *and* reset, or the
	// scheduling guard above would think a snapshot is still pending.
	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
			timer.current = null;
		},
		[],
	);

	// Series identity: hosts (status-free, stable per server list) that have
	// answered at least once in the window. Memoized so the chart config keeps
	// its identity between polls — the kit re-derives bands/series on change.
	const chartKeys = useMemo(
		() =>
			hosts
				.filter((host) =>
					samples.some((s) => s.readings[host.key] !== undefined),
				)
				.map((host) => host.key),
		[hosts, samples],
	);

	const chartConfig = useMemo<ChartConfig>(() => {
		const config: ChartConfig = {};
		for (const host of hosts) {
			if (chartKeys.includes(host.key)) {
				config[host.key] = { label: host.name, color: host.color };
			}
		}
		return config;
	}, [hosts, chartKeys]);

	const { cpuRows, memRows } = useMemo(() => {
		const cpu: SeriesRow[] = [];
		const mem: SeriesRow[] = [];
		for (const sample of samples) {
			const time = format(sample.t, "HH:mm:ss");
			const cpuRow: SeriesRow = { time };
			const memRow: SeriesRow = { time };
			for (const key of chartKeys) {
				const reading = sample.readings[key];
				cpuRow[key] = reading?.cpu ?? 0;
				memRow[key] = reading?.memPct ?? 0;
			}
			cpu.push(cpuRow);
			mem.push(memRow);
		}
		return { cpuRows: cpu, memRows: mem };
	}, [samples, chartKeys]);

	const history = useMemo<FleetSummary["history"]>(() => {
		const perSample = samples.map((s) => aggregate(Object.values(s.readings)));
		return {
			online: samples.map((s) => Object.keys(s.readings).length),
			containers: perSample.map((a) => a.containers),
			cpuAvg: perSample.map((a) => a.cpuAvg ?? 0),
			memUsedGiB: perSample.map((a) => a.memUsedGiB),
		};
	}, [samples]);

	const summary: FleetSummary = {
		online: views.filter((v) => v.status.state === "online").length,
		total: views.length,
		...aggregate(Object.values(latest)),
		history,
	};

	const first = samples[0];
	const last = samples[samples.length - 1];
	const windowLabel =
		first && last && samples.length > 1
			? `live · last ${formatWindow(last.t - first.t)}`
			: "collecting samples…";

	return {
		hosts: views,
		samples,
		windowLabel,
		summary,
		chartHosts: views.filter((v) => chartKeys.includes(v.key)),
		chartConfig,
		cpuRows,
		memRows,
	};
};

export const formatWindow = (ms: number) => {
	const minutes = Math.round(ms / 60000);
	if (minutes < 1) return `${Math.round(ms / 1000)}s`;
	if (minutes < 60) return `${minutes} min`;
	return `${(minutes / 60).toFixed(1)} h`;
};

/** "3d 4h" / "4h 12m" / "12m" */
export const formatUptime = (seconds: number) => {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
};
