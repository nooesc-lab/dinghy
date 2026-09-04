import { format } from "date-fns";
import { ArrowRight, Rocket } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
	HOST_PALETTE,
	hostCss,
	hostHue,
} from "@/components/dashboard/monitoring/fleet/palette";
import {
	Curtain,
	Reveal,
} from "@/components/dashboard/monitoring/fleet/primitives";
import {
	Bar,
	BarChart,
	type ChartConfig,
	type DitherColor,
	DitherAvatar,
	Tooltip,
	XAxis,
} from "@/components/dither-kit";
import { fnv1a } from "@/components/dither-kit/pixel";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/utils/api";

export type Deployment = RouterOutputs["deployment"]["allCentralized"][number];
type DeploymentStatus = "idle" | "running" | "done" | "error";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Days in the deployments-by-day chart */
const CHART_DAYS = 14;
/** Below this many deployments a bar chart is mostly empty bins */
const CHART_MIN_DEPLOYMENTS = 10;
const RECENT_COUNT = 8;

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

export interface Activity {
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

const NO_DEPLOYMENTS: Deployment[] = [];

/** Folds the deployment list into the header counts, both charts and the recent rows. */
export const bucketActivity = (
	list: Deployment[] | undefined = NO_DEPLOYMENTS,
	now: number,
): Activity => {
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

/** The 14-day bar chart over the eight most recent deployments. */
export const DeploymentsPanel = ({
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
