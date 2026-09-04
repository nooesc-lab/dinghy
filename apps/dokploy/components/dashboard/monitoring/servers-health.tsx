import type { ServerHealthResult } from "@dokploy/server/services/server-health";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Area, AreaChart, YAxis } from "recharts";
import { ContainerFreeMonitoring } from "@/components/dashboard/monitoring/free/container/show-free-container-monitoring";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const GIB = 1024 ** 3;
const POLL_MS = 15000;
const MAX_SAMPLES = 40;

const formatGiB = (bytes: number) => (bytes / GIB).toFixed(1);

const formatAgo = (iso: string) => {
	const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
	return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
};

/** "3d 4h" / "4h 12m" / "12m" */
const formatUptime = (seconds: number) => {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
};

const formatWindow = (ms: number) => {
	const minutes = Math.round(ms / 60000);
	if (minutes < 1) return `${Math.round(ms / 1000)}s`;
	if (minutes < 60) return `${minutes} min`;
	return `${(minutes / 60).toFixed(1)} h`;
};

// ---------------------------------------------------------------------------
// Dedupe: one row per unique SSH endpoint; extra registrations become aliases.
// ---------------------------------------------------------------------------

interface FleetHost {
	/** `${ipAddress}:${port}` */
	key: string;
	/** serverId of the first registration; the only one polled */
	serverId: string;
	name: string;
	ip: string;
	/** Names of the other registrations pointing at the same endpoint */
	aliases: string[];
}

interface RegisteredServer {
	serverId: string;
	name: string;
	ipAddress: string;
	port: number;
}

const dedupeHosts = (servers: RegisteredServer[]): FleetHost[] => {
	const byKey = new Map<string, FleetHost>();
	for (const server of servers) {
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
			});
		}
	}
	return [...byKey.values()];
};

// ---------------------------------------------------------------------------
// Sparklines
// ---------------------------------------------------------------------------

interface Sample {
	t: number;
	cpu: number | null;
	memGiB: number | null;
}

interface SparklineProps {
	data: Sample[];
	dataKey: keyof Sample;
	label: string;
	color: string;
	max: number;
	maxLabel: string;
	formatValue: (value: number) => string;
}

const Sparkline = ({
	data,
	dataKey,
	label,
	color,
	max,
	maxLabel,
	formatValue,
}: SparklineProps) => {
	const gradientId = `fleet-fill-${useId().replace(/:/g, "")}`;
	const config = { [dataKey]: { label, color } };
	const colorVar = `var(--color-${dataKey})`;

	return (
		<div className="relative">
			<span className="pointer-events-none absolute right-0 top-0 text-[10px] tabular-nums text-muted-foreground/60">
				{maxLabel}
			</span>
			<ChartContainer config={config} className="aspect-auto h-20 w-full">
				<AreaChart
					data={data}
					margin={{ top: 14, right: 0, left: 0, bottom: 0 }}
				>
					<defs>
						<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={colorVar} stopOpacity={0.2} />
							<stop offset="100%" stopColor={colorVar} stopOpacity={0} />
						</linearGradient>
					</defs>
					<YAxis domain={[0, max]} hide />
					<ChartTooltip
						cursor={false}
						content={
							<ChartTooltipContent
								hideIndicator
								labelFormatter={(_, payload) => {
									const t = payload?.[0]?.payload?.t;
									return typeof t === "number" ? format(t, "HH:mm:ss") : "";
								}}
								formatter={(value) => [
									typeof value === "number" ? formatValue(value) : "—",
									label,
								]}
							/>
						}
					/>
					<Area
						type="monotone"
						isAnimationActive={false}
						dataKey={dataKey}
						stroke={colorVar}
						fill={`url(#${gradientId})`}
						strokeWidth={1.5}
						connectNulls={false}
					/>
				</AreaChart>
			</ChartContainer>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Host card
// ---------------------------------------------------------------------------

interface VitalsPanelProps {
	data: ServerHealthResult;
	samples: Sample[];
}

const VitalsPanel = ({ data, samples }: VitalsPanelProps) => {
	const { vitals } = data;
	const memTotalGiB = vitals.memTotalBytes / GIB;
	const diskPct =
		vitals.diskUsedBytes !== null &&
		vitals.diskTotalBytes !== null &&
		vitals.diskTotalBytes > 0
			? (vitals.diskUsedBytes / vitals.diskTotalBytes) * 100
			: null;
	const first = samples[0];
	const last = samples[samples.length - 1];
	const window =
		first && last && samples.length > 1
			? `last ${formatWindow(last.t - first.t)} · live`
			: "collecting samples…";

	return (
		<div className="flex flex-col gap-3">
			<div className="grid gap-4 sm:grid-cols-3">
				<div className="flex flex-col gap-1">
					<div className="flex items-baseline justify-between">
						<span className="gh-eyebrow">CPU</span>
						<span className="text-xs tabular-nums">
							{vitals.cpuPercent === null ? "—" : `${vitals.cpuPercent.toFixed(0)}%`}
						</span>
					</div>
					<Sparkline
						data={samples}
						dataKey="cpu"
						label="CPU"
						color="var(--primary)"
						max={100}
						maxLabel="100%"
						formatValue={(v) => `${v.toFixed(0)}%`}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<div className="flex items-baseline justify-between">
						<span className="gh-eyebrow">Memory</span>
						<span className="text-xs tabular-nums">
							{formatGiB(vitals.memUsedBytes)} / {formatGiB(vitals.memTotalBytes)}{" "}
							GiB
						</span>
					</div>
					<Sparkline
						data={samples}
						dataKey="memGiB"
						label="Memory"
						color="hsl(var(--chart-2))"
						max={memTotalGiB > 0 ? +memTotalGiB.toFixed(2) : 1}
						maxLabel={`${memTotalGiB.toFixed(1)} GiB`}
						formatValue={(v) => `${v.toFixed(2)} GiB`}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<div className="flex items-baseline justify-between">
						<span className="gh-eyebrow">Disk</span>
						<span className="text-xs tabular-nums">
							{diskPct === null ? "—" : `${diskPct.toFixed(0)}%`}
						</span>
					</div>
					<div className="flex h-20 flex-col justify-center gap-2">
						<Progress value={diskPct ?? 0} className="h-1.5" />
						<span className="text-xs tabular-nums text-muted-foreground">
							{vitals.diskUsedBytes === null || vitals.diskTotalBytes === null
								? "root filesystem unavailable"
								: `${formatGiB(vitals.diskUsedBytes)} / ${formatGiB(vitals.diskTotalBytes)} GiB on /`}
						</span>
					</div>
				</div>
			</div>
			<div className="flex justify-between text-[11px] text-muted-foreground/70">
				<span>
					{window} · {samples.length} sample{samples.length === 1 ? "" : "s"}{" "}
					every {POLL_MS / 1000}s
				</span>
				<span>checked {formatAgo(data.checkedAt)}</span>
			</div>
		</div>
	);
};

interface HostCardProps {
	serverId?: string;
	name: string;
	ip: string;
	aliases?: string[];
	defaultExpanded?: boolean;
	/** Replaces the SSH-polled vitals panel (Local host mounts the full docker charts). */
	children?: ReactNode;
}

const HostCard = ({
	serverId,
	name,
	ip,
	aliases = [],
	defaultExpanded = false,
	children,
}: HostCardProps) => {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const [samples, setSamples] = useState<Sample[]>([]);
	const bodyId = useId();

	const { data, error } = api.docker.getServerHealth.useQuery(
		serverId ? { serverId } : {},
		{
			refetchInterval: POLL_MS,
			retry: false,
			refetchOnWindowFocus: false,
		},
	);

	const failure = error?.message ?? data?.error;
	const checkedAt = failure ? undefined : data?.checkedAt;

	// Accumulate one sample per successful poll while the page is mounted.
	useEffect(() => {
		if (!checkedAt || !data) return;
		const sample: Sample = {
			t: Date.parse(checkedAt),
			cpu: data.vitals.cpuPercent,
			memGiB: data.vitals.memTotalBytes > 0 ? data.vitals.memUsedBytes / GIB : null,
		};
		setSamples((prev) => {
			if (prev[prev.length - 1]?.t === sample.t) return prev;
			const next = [...prev, sample];
			return next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
		});
	}, [checkedAt, data]);

	let dotClass = "bg-muted-foreground animate-pulse";
	let status: ReactNode = "checking…";
	if (failure) {
		dotClass = "bg-destructive";
		status = "unreachable";
	} else if (data) {
		dotClass = "bg-primary shadow-[0_0_8px] shadow-primary/40";
		const { containers, resources, vitals } = data;
		const parts = [
			`${containers.containerCount} containers`,
			`${formatGiB(resources.memUsedBytes)}/${formatGiB(resources.memTotalBytes)} GiB`,
			`${resources.cpuCount} cpus`,
		];
		if (vitals.uptimeSec !== null) parts.push(`up ${formatUptime(vitals.uptimeSec)}`);
		if (vitals.loadAvg1 !== null) parts.push(`load ${vitals.loadAvg1.toFixed(2)}`);
		status = <span className="tabular-nums">{parts.join(" · ")}</span>;
	}

	const allNames = [name, ...aliases];

	return (
		<div className="gh-surface rounded-lg">
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				aria-expanded={expanded}
				aria-controls={bodyId}
				className={cn(
					"gh-interactive flex w-full items-center gap-3 px-4 py-3 text-left",
					expanded ? "rounded-t-lg" : "rounded-lg",
				)}
			>
				<ChevronRight
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
						expanded && "rotate-90",
					)}
					aria-hidden
				/>
				<span className={`size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
				<span className="min-w-0 truncate text-sm font-medium" title={allNames.join(", ")}>
					{name}
					{aliases.length > 0 && (
						<span className="font-normal text-muted-foreground/70">
							{" "}
							· also registered as {aliases.join(", ")}
						</span>
					)}
				</span>
				<span className="truncate text-xs text-muted-foreground">{ip}</span>
				<span className="ml-auto shrink-0 text-right text-xs text-muted-foreground">
					{status}
				</span>
			</button>
			{expanded && (
				<div id={bodyId} className="border-t border-border px-4 py-4">
					{failure && (
						<pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
							{failure}
						</pre>
					)}
					{children ??
						(failure ? null : data ? (
							<VitalsPanel data={data} samples={samples} />
						) : (
							<span className="text-xs text-muted-foreground">checking…</span>
						))}
				</div>
			)}
		</div>
	);
};

// ---------------------------------------------------------------------------
// Fleet overview
// ---------------------------------------------------------------------------

export const ServersHealth = () => {
	const { data: servers } = api.server.all.useQuery();
	const hosts = useMemo(() => dedupeHosts(servers ?? []), [servers]);

	return (
		<section className="space-y-4">
			<div className="flex flex-col gap-0.5">
				<span className="gh-eyebrow">Fleet</span>
				<h1 className="text-lg font-semibold">Monitoring</h1>
				<p className="text-sm text-muted-foreground">
					Live health across your servers
				</p>
			</div>
			<div className="flex flex-col gap-2">
				<HostCard name="Local" ip="Dinghy host" defaultExpanded>
					<ContainerFreeMonitoring appName="dokploy" />
				</HostCard>
				{hosts.map((host) => (
					<HostCard
						key={host.key}
						serverId={host.serverId}
						name={host.name}
						ip={host.ip}
						aliases={host.aliases}
					/>
				))}
			</div>
		</section>
	);
};
