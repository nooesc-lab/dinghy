import { format } from "date-fns";
import { ArrowRight, Rocket } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, type ReactNode, useMemo } from "react";
import {
	HOST_PALETTE,
	hostCss,
	hostHue,
} from "@/components/dashboard/monitoring/fleet/palette";
import {
	Collecting,
	Curtain,
	Reveal,
} from "@/components/dashboard/monitoring/fleet/primitives";
import { Spark } from "@/components/dashboard/monitoring/fleet/spark";
import {
	type FleetSummary,
	useFleet,
} from "@/components/dashboard/monitoring/fleet/use-fleet";
import { HandleProject } from "@/components/dashboard/projects/handle-project";
import {
	Bar,
	BarChart,
	type ChartConfig,
	type DitherColor,
	DitherAvatar,
	DitherGradient,
	Tooltip,
	XAxis,
} from "@/components/dither-kit";
import { fnv1a } from "@/components/dither-kit/pixel";
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/utils/api";

type Deployment = RouterOutputs["deployment"]["allCentralized"][number];
type DeploymentStatus = "idle" | "running" | "done" | "error";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Days in the deployments-by-day chart */
const CHART_DAYS = 14;
/** Below this many deployments a bar chart is mostly empty bins */
const CHART_MIN_DEPLOYMENTS = 10;
const RECENT_COUNT = 8;

const REFRESH_MS = 10_000;

const STATUS_LABEL: Record<DeploymentStatus, string> = {
	done: "done",
	running: "deploying",
	error: "failed",
	idle: "queued",
};

/** Dot + text colour per deployment state; null keeps the muted default. */
const statusStyle = (status: DeploymentStatus) => {
	switch (status) {
		case "done":
			return {
				dot: {
					backgroundColor: hostCss("green"),
					boxShadow: `0 0 8px ${hostCss("green", 0.6)}`,
				},
				text: undefined,
			};
		case "running":
			return {
				dot: {
					backgroundColor: hostCss("orange"),
					boxShadow: `0 0 8px ${hostCss("orange", 0.6)}`,
				},
				text: { color: hostCss("orange") },
			};
		case "error":
			return {
				dot: { backgroundColor: "var(--destructive)" },
				text: { color: "var(--destructive)" },
			};
		default:
			return {
				dot: { backgroundColor: "var(--muted-foreground)" },
				text: undefined,
			};
	}
};

/** A project's colour, stable across reloads — same palette the fleet uses for hosts. */
const projectColor = (projectName: string): DitherColor =>
	HOST_PALETTE[fnv1a(projectName) % HOST_PALETTE.length] ?? "green";

const getServiceInfo = (d: Deployment) => {
	const app = d.application;
	const comp = d.compose;
	const serverName: string =
		d.server?.name ?? app?.server?.name ?? comp?.server?.name ?? "Dinghy";
	if (app?.environment?.project) {
		return {
			name: app.name,
			environment: app.environment.name,
			projectName: app.environment.project.name,
			serverName,
			href: `/dashboard/project/${app.environment.project.projectId}/environment/${app.environment.environmentId}/services/application/${app.applicationId}`,
		};
	}
	if (comp?.environment?.project) {
		return {
			name: comp.name,
			environment: comp.environment.name,
			projectName: comp.environment.project.name,
			serverName,
			href: `/dashboard/project/${comp.environment.project.projectId}/environment/${comp.environment.environmentId}/services/compose/${comp.composeId}`,
		};
	}
	return null;
};

/** "12s" / "3m 04s" / "1h 12m" */
const formatDuration = (ms: number) => {
	const s = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
	if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
	return `${sec}s`;
};

/** "now" / "4m ago" / "3h ago" / "2d ago" — compact enough for a mono cell. */
const formatAgo = (ms: number) => {
	if (ms < 60_000) return "now";
	const m = Math.floor(ms / 60_000);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
};

/**
 * Elapsed for an in-flight deployment, wall time for a settled one. Null when
 * the record never got a start (pre-timestamp rows).
 */
const deploymentDuration = (d: Deployment, now: number): number | null => {
	const start = d.startedAt ?? d.createdAt;
	if (!start) return null;
	const startMs = new Date(start).getTime();
	if (d.status === "running") return now - startMs;
	if (!d.finishedAt) return null;
	return new Date(d.finishedAt).getTime() - startMs;
};

interface DayBucket {
	day: string;
	deploys: number;
}

interface Activity {
	recent: Deployment[];
	/** Since local midnight */
	today: number;
	inFlight: number;
	/** Deployments per hour over the last 24h, oldest first */
	hourly: number[];
	/** Deployments per day over the last CHART_DAYS, oldest first */
	daily: DayBucket[];
	total: number;
}

const bucketActivity = (list: Deployment[], now: number): Activity => {
	const midnight = new Date(now);
	midnight.setHours(0, 0, 0, 0);
	const midnightMs = midnight.getTime();

	const hourly = new Array<number>(24).fill(0);
	const daily: DayBucket[] = [];
	for (let i = CHART_DAYS - 1; i >= 0; i--) {
		daily.push({
			day: format(midnightMs - i * DAY, "d MMM"),
			deploys: 0,
		});
	}

	let today = 0;
	let inFlight = 0;
	for (const d of list) {
		const t = new Date(d.createdAt).getTime();
		if (d.status === "running") inFlight++;
		if (t >= midnightMs) today++;
		const age = now - t;
		if (age >= 0 && age < DAY) {
			const slot = 23 - Math.floor(age / HOUR);
			hourly[slot] = (hourly[slot] ?? 0) + 1;
		}
		const daysBack =
			t >= midnightMs ? 0 : Math.floor((midnightMs - t) / DAY) + 1;
		const bucket = daily[CHART_DAYS - 1 - daysBack];
		if (bucket) bucket.deploys++;
	}

	const recent = [...list]
		.sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		)
		.slice(0, RECENT_COUNT);

	return { recent, today, inFlight, hourly, daily, total: list.length };
};

/* ----------------------------------------------------------------------- */

interface MeterPart {
	label: string;
	value: number;
	/** null → the muted neutral */
	color: DitherColor | null;
}

/** Proportional segmented bar with a swatch legend — a breakdown at a glance. */
const Meter = ({ parts }: { parts: MeterPart[] }) => {
	const total = parts.reduce((sum, p) => sum + p.value, 0);
	const css = (color: DitherColor | null, alpha = 1) =>
		color === null
			? `color-mix(in srgb, var(--muted-foreground) ${alpha * 45}%, transparent)`
			: hostCss(color, alpha);
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex h-1 w-full gap-px overflow-hidden rounded-full bg-muted">
				{total > 0 &&
					parts.map(
						(p) =>
							p.value > 0 && (
								<span
									key={p.label}
									className="h-full transition-[width] duration-700"
									style={{
										width: `${(p.value / total) * 100}%`,
										backgroundColor: css(p.color),
										boxShadow:
											p.color === null
												? undefined
												: `0 0 6px ${css(p.color, 0.5)}`,
									}}
								/>
							),
					)}
			</div>
			<div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
				{parts.map((p) => (
					<span key={p.label} className="flex items-center gap-1.5">
						<span
							aria-hidden
							className="inline-block size-1.5 rounded-[1px]"
							style={{ backgroundColor: css(p.color) }}
						/>
						{p.value} {p.label}
					</span>
				))}
			</div>
		</div>
	);
};

interface TileProps {
	label: string;
	value: string;
	sub: string;
	delay: number;
	/** The tile's bottom slot: a spark, a meter, or a link. Omitted → empty. */
	children?: ReactNode;
}

const Tile = ({ label, value, sub, delay, children }: TileProps) => (
	<Reveal delay={delay} className="flex flex-col justify-between bg-card">
		<div className="flex flex-col gap-1 px-4 pt-4">
			<span className="gh-eyebrow">{label}</span>
			<span className="text-xl font-semibold tabular-nums tracking-tight">
				{value}
			</span>
			<span className="text-[11px] text-muted-foreground">{sub}</span>
		</div>
		<div className="mt-3 h-9 w-full px-4 pb-2">{children}</div>
	</Reveal>
);

const quickLinkClass =
	"gh-interactive flex h-8 items-center gap-1.5 rounded border border-border px-2.5 font-mono text-[11px] text-muted-foreground hover:text-foreground";

/* ----------------------------------------------------------------------- */

interface FleetStripProps {
	summary: FleetSummary;
	windowLabel: string;
	delay: number;
}

interface FleetRowProps {
	label: string;
	value: string;
	color: DitherColor;
	history: number[];
}

const FleetRow = ({ label, value, color, history }: FleetRowProps) => (
	<li className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 px-4 py-2.5">
		<span className="flex min-w-0 flex-col gap-0.5">
			<span className="gh-eyebrow">{label}</span>
			<span className="truncate text-sm font-semibold tabular-nums tracking-tight">
				{value}
			</span>
		</span>
		<span className="h-7 w-full">
			{history.length < 2 ? (
				<Collecting className="h-full" hint="collecting" />
			) : (
				<Spark data={history} color={color} />
			)}
		</span>
	</li>
);

/** Three fleet vitals with sparks, linking through to the full monitoring page. */
const FleetStrip = ({ summary, windowLabel, delay }: FleetStripProps) => {
	const down = summary.total - summary.online;
	const memPct =
		summary.memTotalGiB > 0
			? (summary.memUsedGiB / summary.memTotalGiB) * 100
			: null;
	return (
		<Reveal delay={delay}>
			<section className="gh-surface flex flex-col rounded-lg" aria-label="Fleet">
				<div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-3">
					<div className="flex flex-col gap-0.5">
						<span className="gh-eyebrow">Fleet</span>
						<span className="text-sm font-medium">
							{summary.total === 0
								? "No hosts yet"
								: down > 0
									? `${down} host${down === 1 ? "" : "s"} unreachable`
									: "All hosts reachable"}
						</span>
					</div>
					<span className="truncate font-mono text-[11px] text-muted-foreground">
						{windowLabel}
					</span>
				</div>
				<ul className="divide-y divide-border border-t border-border">
					<FleetRow
						label="Hosts online"
						value={`${summary.online} / ${summary.total}`}
						color="green"
						history={summary.history.online}
					/>
					<FleetRow
						label="CPU · fleet average"
						value={
							summary.cpuAvg === null ? "—" : `${summary.cpuAvg.toFixed(0)}%`
						}
						color="orange"
						history={summary.history.cpuAvg}
					/>
					<FleetRow
						label="Memory · fleet"
						value={
							memPct === null
								? "—"
								: `${summary.memUsedGiB.toFixed(1)} / ${summary.memTotalGiB.toFixed(1)} GiB · ${memPct.toFixed(0)}%`
						}
						color="purple"
						history={summary.history.memUsedGiB}
					/>
				</ul>
				<Link
					href="/dashboard/monitoring"
					className="gh-interactive mt-auto flex items-center justify-between rounded-b-lg border-t border-border px-4 py-2.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
				>
					Open monitoring
					<ArrowRight className="size-3.5" />
				</Link>
			</section>
		</Reveal>
	);
};

/* ----------------------------------------------------------------------- */

const DEPLOY_COLUMNS =
	"grid-cols-[minmax(0,1fr)_4.5rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_5rem_5rem]";

const DEPLOY_CHART_CONFIG: ChartConfig = {
	deploys: { label: "Deployments", color: "green" },
};
const DEPLOY_CHART_MARGINS = { top: 6, right: 8, bottom: 20, left: 8 };

const Cell = ({
	children,
	className,
	style,
}: {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}) => (
	<span
		className={cn(
			"hidden truncate text-right font-mono text-xs tabular-nums text-muted-foreground sm:block",
			className,
		)}
		style={style}
	>
		{children}
	</span>
);

interface DeploymentRowProps {
	deployment: Deployment;
	now: number;
	delay: number;
}

const DeploymentRow = ({ deployment: d, now, delay }: DeploymentRowProps) => {
	const info = getServiceInfo(d);
	if (!info) return null;
	const status = (d.status ?? "idle") as DeploymentStatus;
	const style = statusStyle(status);
	const duration = deploymentDuration(d, now);
	const createdMs = new Date(d.createdAt).getTime();
	const color = projectColor(info.projectName);

	return (
		<Reveal as="li" delay={delay}>
			<Link
				href={info.href}
				className={cn(
					"gh-interactive grid w-full items-center gap-3 px-4 py-2.5",
					DEPLOY_COLUMNS,
				)}
			>
				<span className="flex min-w-0 items-center gap-3">
					<span className="relative shrink-0">
						<DitherAvatar
							name={info.name}
							hue={hostHue(color)}
							size={28}
							bloom="low"
							className="rounded-[3px]"
						/>
						<span
							aria-hidden
							className={cn(
								"absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-card",
								status === "running" && "animate-pulse",
							)}
							style={style.dot}
						/>
					</span>
					<span className="flex min-w-0 flex-col">
						<span className="flex min-w-0 items-baseline gap-2">
							<span className="truncate text-sm font-medium">{info.name}</span>
							{d.title && d.title !== "Deployment" && (
								<span className="hidden truncate text-[11px] text-muted-foreground/70 md:inline">
									{d.title}
								</span>
							)}
						</span>
						<span className="truncate font-mono text-[11px] text-muted-foreground">
							<span style={{ color: hostCss(color) }}>{info.projectName}</span>
							{" · "}
							{info.environment}
							<span className="hidden lg:inline"> · {info.serverName}</span>
						</span>
					</span>
				</span>

				<Cell style={style.text}>{STATUS_LABEL[status]}</Cell>
				<Cell>{duration === null ? "—" : formatDuration(duration)}</Cell>
				<span
					className="truncate text-right font-mono text-xs tabular-nums text-muted-foreground"
					title={format(createdMs, "PPpp")}
				>
					{formatAgo(now - createdMs)}
				</span>
			</Link>
		</Reveal>
	);
};

const DeploymentsEmpty = ({
	children,
}: {
	children: ReactNode;
}) => (
	<div className="flex min-h-56 flex-col items-center justify-center gap-3 p-10 text-center text-sm text-muted-foreground">
		<Rocket className="size-8 opacity-40" />
		<span>{children}</span>
	</div>
);

interface DeploymentsPanelProps {
	canRead: boolean;
	activity: Activity;
	now: number;
	delay: number;
}

const DeploymentsPanel = ({
	canRead,
	activity,
	now,
	delay,
}: DeploymentsPanelProps) => {
	const showChart = canRead && activity.total >= CHART_MIN_DEPLOYMENTS;
	return (
		<Reveal delay={delay}>
			<section className="gh-surface rounded-lg" aria-label="Recent deployments">
				<div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-3">
					<div className="flex flex-col gap-0.5">
						<span className="gh-eyebrow">Activity</span>
						<span className="text-sm font-medium">Recent deployments</span>
					</div>
					{canRead && (
						<Link
							href="/dashboard/overview?tab=deployments"
							className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
						>
							view all
							<ArrowRight className="size-3" />
						</Link>
					)}
				</div>

				{showChart && (
					<div className="border-t border-border px-2 pt-3">
						<div className="flex items-baseline justify-between px-2 pb-1">
							<span className="gh-eyebrow">Last {CHART_DAYS} days</span>
							<span className="font-mono text-[11px] tabular-nums text-muted-foreground">
								{activity.daily.reduce((sum, b) => sum + b.deploys, 0)} deploys
							</span>
						</div>
						<div className="relative h-28">
							<BarChart
								data={activity.daily}
								config={DEPLOY_CHART_CONFIG}
								bloom="low"
								animate={false}
								margins={DEPLOY_CHART_MARGINS}
							>
								<XAxis dataKey="day" maxTicks={7} />
								<Tooltip
									labelKey="day"
									valueFormatter={(v) => `${v} deploy${v === 1 ? "" : "s"}`}
								/>
								<Bar dataKey="deploys" variant="gradient" />
							</BarChart>
							<Curtain delay={delay + 0.1} />
						</div>
					</div>
				)}

				{!canRead ? (
					<div className="border-t border-border">
						<DeploymentsEmpty>
							You do not have permission to view deployments.
						</DeploymentsEmpty>
					</div>
				) : activity.recent.length === 0 ? (
					<div className="border-t border-border">
						<DeploymentsEmpty>
							No deployments yet — deploy a service and it shows up here.
						</DeploymentsEmpty>
					</div>
				) : (
					<>
						<div
							className={cn(
								"grid gap-3 border-y border-border px-4 pt-3 pb-1.5",
								DEPLOY_COLUMNS,
							)}
						>
							<span className="gh-eyebrow">service</span>
							<Cell className="gh-eyebrow">status</Cell>
							<Cell className="gh-eyebrow">took</Cell>
							<span className="gh-eyebrow text-right">when</span>
						</div>
						<ul className="divide-y divide-border">
							{activity.recent.map((d, i) => (
								<DeploymentRow
									key={d.deploymentId}
									deployment={d}
									now={now}
									delay={delay + 0.05 + i * 0.04}
								/>
							))}
						</ul>
					</>
				)}
			</section>
		</Reveal>
	);
};

/* ----------------------------------------------------------------------- */

const NO_DEPLOYMENTS: Deployment[] = [];

export const ShowHome = () => {
	const { data: auth } = api.user.get.useQuery();
	const { data: homeStats } = api.project.homeStats.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();
	const { data: isCloud } = api.settings.isCloud.useQuery();

	const canReadDeployments = !!permissions?.deployment.read;
	const canCreateProject = !!permissions?.project.create;
	// Same gate as the sidebar link plus what fleet.history itself checks.
	const canFleet =
		!isCloud &&
		!!permissions?.monitoring.read &&
		!!permissions?.docker.read &&
		!!permissions?.server.read;

	const { data: deployments, dataUpdatedAt } =
		api.deployment.allCentralized.useQuery(undefined, {
			enabled: canReadDeployments,
			refetchInterval: REFRESH_MS,
		});
	const fleet = useFleet({ enabled: canFleet });

	const firstName = auth?.user?.firstName?.trim();

	const totals = homeStats ?? {
		projects: 0,
		environments: 0,
		applications: 0,
		compose: 0,
		databases: 0,
		services: 0,
	};
	const statusBreakdown = homeStats?.status ?? {
		running: 0,
		error: 0,
		idle: 0,
	};

	// `now` is pinned to the last fetch so the derived buckets and the "ago"
	// cells only move when the data does, not on every unrelated render.
	const now = dataUpdatedAt || Date.now();
	const activity = useMemo(
		() => bucketActivity(deployments ?? NO_DEPLOYMENTS, now),
		[deployments, now],
	);

	const hasActivity = canReadDeployments && activity.total > 0;

	return (
		<div className="flex flex-col gap-4 pb-10">
			<Reveal>
				<header className="gh-surface relative overflow-hidden rounded-lg">
					<DitherGradient
						from="green"
						direction="right"
						cell={3}
						opacity={0.14}
						className="w-2/3"
					/>
					<div className="relative flex flex-col gap-5 p-5">
						<div className="flex flex-wrap items-end justify-between gap-4">
							<div className="flex flex-col gap-0.5">
								<span className="gh-eyebrow">Home</span>
								<h1 className="text-lg font-semibold tracking-tight">
									{firstName ? `Welcome back, ${firstName}` : "Welcome back"}
								</h1>
								<p className="text-sm text-muted-foreground">
									{totals.services} service{totals.services === 1 ? "" : "s"}{" "}
									across {totals.projects} project
									{totals.projects === 1 ? "" : "s"}
									{activity.inFlight > 0 && (
										<span style={{ color: hostCss("orange") }}>
											{" "}
											· {activity.inFlight} deploying now
										</span>
									)}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Link href="/dashboard/projects" className={quickLinkClass}>
									Projects
									<ArrowRight className="size-3" />
								</Link>
								{canReadDeployments && (
									<Link
										href="/dashboard/overview?tab=deployments"
										className={quickLinkClass}
									>
										Deployments
										<ArrowRight className="size-3" />
									</Link>
								)}
								{canFleet && (
									<Link href="/dashboard/monitoring" className={quickLinkClass}>
										Monitoring
										<ArrowRight className="size-3" />
									</Link>
								)}
								{canCreateProject && <HandleProject />}
							</div>
						</div>

						<div className="grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
							<Tile
								label="Projects"
								value={String(totals.projects)}
								sub={`${totals.environments} environment${totals.environments === 1 ? "" : "s"}`}
								delay={0.05}
							>
								<Link
									href="/dashboard/projects"
									className="flex h-full items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
								>
									open projects
									<ArrowRight className="size-3" />
								</Link>
							</Tile>
							<Tile
								label="Services"
								value={String(totals.services)}
								sub="applications, compose stacks and databases"
								delay={0.1}
							>
								<Meter
									parts={[
										{ label: "apps", value: totals.applications, color: "green" },
										{ label: "compose", value: totals.compose, color: "blue" },
										{ label: "db", value: totals.databases, color: "purple" },
									]}
								/>
							</Tile>
							<Tile
								label="Running"
								value={String(statusBreakdown.running)}
								sub={
									statusBreakdown.error > 0
										? `${statusBreakdown.error} errored · ${statusBreakdown.idle} idle`
										: `${statusBreakdown.idle} idle · nothing errored`
								}
								delay={0.15}
							>
								<Meter
									parts={[
										{
											label: "running",
											value: statusBreakdown.running,
											color: "green",
										},
										{
											label: "errored",
											value: statusBreakdown.error,
											color: "red",
										},
										{ label: "idle", value: statusBreakdown.idle, color: null },
									]}
								/>
							</Tile>
							<Tile
								label="Deploys today"
								value={canReadDeployments ? String(activity.today) : "—"}
								sub={
									!canReadDeployments
										? "no deployment access"
										: hasActivity
											? "per hour · last 24h"
											: "no activity yet"
								}
								delay={0.2}
							>
								{hasActivity && <Spark data={activity.hourly} color="green" />}
							</Tile>
						</div>
					</div>
				</header>
			</Reveal>

			<div className={cn("grid gap-4", canFleet && "lg:grid-cols-3")}>
				<div className={cn(canFleet && "lg:col-span-2")}>
					<DeploymentsPanel
						canRead={canReadDeployments}
						activity={activity}
						now={now}
						delay={0.3}
					/>
				</div>
				{canFleet && (
					<FleetStrip
						summary={fleet.summary}
						windowLabel={fleet.windowLabel}
						delay={0.35}
					/>
				)}
			</div>
		</div>
	);
};
