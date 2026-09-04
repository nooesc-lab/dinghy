import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { LocalDetail } from "@/components/dashboard/monitoring/fleet/local-detail";
import { hostCss } from "@/components/dashboard/monitoring/fleet/palette";
import {
	Collecting,
	Reveal,
} from "@/components/dashboard/monitoring/fleet/primitives";
import { Spark } from "@/components/dashboard/monitoring/fleet/spark";
import {
	type FleetSummary,
	LOCAL_HOST_KEY,
	useFleet,
} from "@/components/dashboard/monitoring/fleet/use-fleet";
import { HandleProject } from "@/components/dashboard/projects/handle-project";
import { type DitherColor, DitherGradient } from "@/components/dither-kit";
import { api } from "@/utils/api";
import { bucketActivity, DeploymentsPanel } from "./deployments-panel";
import { FleetSection } from "./fleet-section";

const REFRESH_MS = 10_000;

/** Reveal offsets, top to bottom. Tiles step from `tiles`; sections follow. */
const DELAY = {
	tiles: 0.05,
	tileStep: 0.04,
	fleet: 0.35,
	local: 0.65,
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

/** A tile's history spark at the slot's fixed height, or a dither placeholder before two samples exist. */
const SparkSlot = ({
	history,
	color,
}: {
	history: number[];
	color: DitherColor;
}) => (
	<span className="block h-7">
		{history.length < 2 ? (
			<Collecting className="h-full" hint="collecting" />
		) : (
			<Spark data={history} color={color} />
		)}
	</span>
);

interface TileProps {
	label: string;
	value: string;
	sub: string;
	delay: number;
	/** The tile's bottom slot: a spark, a meter, or a link. Omitted → empty. */
	children?: ReactNode;
}

/** One cell of the tile strip. The bottom slot grows past `h-9` only when a legend wraps. */
const Tile = ({ label, value, sub, delay, children }: TileProps) => (
	<Reveal delay={delay} className="flex flex-col justify-between bg-card">
		<div className="flex flex-col gap-1 px-4 pt-4">
			<span className="gh-eyebrow">{label}</span>
			<span className="text-xl font-semibold tabular-nums tracking-tight">
				{value}
			</span>
			<span className="text-[11px] text-muted-foreground">{sub}</span>
		</div>
		<div className="mt-3 min-h-9 w-full px-4 pb-2">{children}</div>
	</Reveal>
);

/** The four fleet vitals, in the same tile treatment as the product counts above them. */
const FleetTiles = ({
	summary,
	delay,
}: {
	summary: FleetSummary;
	delay: number;
}) => {
	const down = summary.total - summary.online;
	const memPct =
		summary.memTotalGiB > 0
			? (summary.memUsedGiB / summary.memTotalGiB) * 100
			: null;
	return (
		<>
			<Tile
				label="Hosts online"
				value={`${summary.online} / ${summary.total}`}
				sub={
					down > 0
						? `${down} unreachable`
						: summary.total === 0
							? "no hosts yet"
							: "all reachable"
				}
				delay={delay}
			>
				<SparkSlot history={summary.history.online} color="green" />
			</Tile>
			<Tile
				label="Containers"
				value={String(summary.containers)}
				sub={`across ${summary.online} host${summary.online === 1 ? "" : "s"}`}
				delay={delay + DELAY.tileStep}
			>
				<SparkSlot history={summary.history.containers} color="blue" />
			</Tile>
			<Tile
				label="CPU · fleet avg"
				value={summary.cpuAvg === null ? "—" : `${summary.cpuAvg.toFixed(0)}%`}
				sub="mean of online hosts"
				delay={delay + DELAY.tileStep * 2}
			>
				<SparkSlot history={summary.history.cpuAvg} color="orange" />
			</Tile>
			<Tile
				label="Memory · fleet"
				value={memPct === null ? "—" : `${summary.memUsedGiB.toFixed(1)} GiB`}
				sub={
					memPct === null
						? "no memory readings yet"
						: `of ${summary.memTotalGiB.toFixed(1)} GiB · ${memPct.toFixed(0)}% in use`
				}
				delay={delay + DELAY.tileStep * 3}
			>
				<SparkSlot history={summary.history.memUsedGiB} color="purple" />
			</Tile>
		</>
	);
};

const quickLinkClass =
	"gh-interactive flex h-8 items-center gap-1.5 rounded border border-border px-2.5 font-mono text-[11px] text-muted-foreground hover:text-foreground";

/* ----------------------------------------------------------------------- */

export const ShowHome = () => {
	const { data: auth } = api.user.get.useQuery();
	const { data: homeStats } = api.project.homeStats.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();
	const { data: isCloud } = api.settings.isCloud.useQuery();

	const canReadDeployments = !!permissions?.deployment.read;
	const canCreateProject = !!permissions?.project.create;
	// What fleet.history itself checks; the fleet is a self-hosted concept.
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
	const localHost = fleet.hosts.find((host) => host.key === LOCAL_HOST_KEY);

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
		() => bucketActivity(deployments, now),
		[deployments, now],
	);

	const hasActivity = canReadDeployments && activity.total > 0;
	// The deployments panel sits under the fleet section when there is one.
	const deploymentsDelay = canFleet ? DELAY.fleet + 0.25 : DELAY.fleet;

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
							<div className="flex grow flex-col items-start gap-3 sm:items-end">
								{canFleet && (
									<span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
										<span
											aria-hidden
											className="size-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_8px] shadow-primary/60"
										/>
										<span className="tabular-nums">{fleet.windowLabel}</span>
									</span>
								)}
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
										<Link href="#fleet" className={quickLinkClass}>
											Fleet
											<ArrowRight className="size-3 rotate-90" />
										</Link>
									)}
									{canCreateProject && <HandleProject />}
								</div>
							</div>
						</div>

						<div className="grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
							<Tile
								label="Projects"
								value={String(totals.projects)}
								sub={`${totals.environments} environment${totals.environments === 1 ? "" : "s"}`}
								delay={DELAY.tiles}
							>
								<Link
									href="/dashboard/projects"
									className="flex h-7 items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
								>
									open projects
									<ArrowRight className="size-3" />
								</Link>
							</Tile>
							<Tile
								label="Services"
								value={String(totals.services)}
								sub="applications, compose stacks and databases"
								delay={DELAY.tiles + DELAY.tileStep}
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
								delay={DELAY.tiles + DELAY.tileStep * 2}
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
								delay={DELAY.tiles + DELAY.tileStep * 3}
							>
								{hasActivity && (
									<SparkSlot history={activity.hourly} color="green" />
								)}
							</Tile>
							{canFleet && (
								<FleetTiles
									summary={fleet.summary}
									delay={DELAY.tiles + DELAY.tileStep * 4}
								/>
							)}
						</div>
					</div>
				</header>
			</Reveal>

			{canFleet && <FleetSection fleet={fleet} delay={DELAY.fleet} />}

			<DeploymentsPanel
				canRead={canReadDeployments}
				activity={activity}
				now={now}
				delay={deploymentsDelay}
			/>

			{canFleet && localHost && (
				<LocalDetail host={localHost} delay={DELAY.local} />
			)}
		</div>
	);
};
