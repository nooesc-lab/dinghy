import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import {
	type HostColor,
	hostCss,
	hostHue,
} from "@/components/dashboard/monitoring/fleet/palette";
import {
	Collecting,
	Reveal,
} from "@/components/dashboard/monitoring/fleet/primitives";
import { Spark } from "@/components/dashboard/monitoring/fleet/spark";
import {
	type FleetHostView,
	formatUptime,
	GIB,
	type Sample,
} from "@/components/dashboard/monitoring/fleet/use-fleet";
import { DitherAvatar, DitherGradient } from "@/components/dither-kit";
import { DateTooltip } from "@/components/shared/date-tooltip";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/utils/api";

export type ServerView = RouterOutputs["server"]["all"][number];

/**
 * The sampler dedupes registrations by ip:port and keys the polled host on
 * the first registration's serverId, so a card matches its own serverId first
 * and falls back to the fleet host's ip for the aliases that were deduped
 * away. The local Dinghy host has no serverId and never matches.
 */
export const fleetHostFor = (hosts: FleetHostView[], server: ServerView) =>
	hosts.find((host) => host.serverId === server.serverId) ??
	hosts.find(
		(host) => host.serverId !== undefined && host.ip === server.ipAddress,
	);

/**
 * `inactive` is the cloud billing flag on the row itself; the rest come from
 * the fleet: `online` has a live sample, `unreachable` failed its last poll,
 * `pending` has never answered (setup not run yet, or still being checked).
 * `unknown` means the viewer can't read the fleet at all.
 */
export type ServerState =
	| "online"
	| "unreachable"
	| "pending"
	| "inactive"
	| "unknown";

export const serverStateOf = (
	server: ServerView,
	host: FleetHostView | undefined,
	fleetEnabled: boolean,
): ServerState => {
	if (server.serverStatus !== "active") return "inactive";
	if (!fleetEnabled) return "unknown";
	if (!host || host.status.state === "checking") return "pending";
	return host.status.state;
};

const STATE_DOT: Record<ServerState, CSSProperties> = {
	online: {
		backgroundColor: hostCss("green"),
		boxShadow: `0 0 8px ${hostCss("green", 0.6)}`,
	},
	unreachable: { backgroundColor: "var(--destructive)" },
	inactive: { backgroundColor: "var(--destructive)" },
	pending: { backgroundColor: "var(--muted-foreground)" },
	unknown: { backgroundColor: "var(--muted-foreground)", opacity: 0.45 },
};

const STATE_LABEL: Record<ServerState, string> = {
	online: "reachable",
	unreachable: "unreachable",
	inactive: "inactive",
	pending: "pending setup",
	unknown: "no fleet access",
};

/** GiB below a tebibyte, TiB with one decimal above. */
const formatBytes = (bytes: number) =>
	bytes >= GIB * 1024
		? `${(bytes / (GIB * 1024)).toFixed(1)} TiB`
		: `${(bytes / GIB).toFixed(0)} GiB`;

const chipClass =
	"shrink-0 rounded-sm border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.08em]";

/**
 * Tooltip around a composed dialog trigger. The dialogs render their own
 * `outline` icon buttons; the wrapper flattens them to a quiet ghost at rest
 * (their own hover styles still apply) so the row reads as one control strip.
 */
export const IconAction = ({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) => (
	<Tooltip>
		<TooltipTrigger asChild>
			<div className="[&>button]:size-8 [&>button]:rounded [&>button]:border-transparent [&>button]:bg-transparent [&>button]:text-muted-foreground dark:[&>button]:border-transparent dark:[&>button]:bg-transparent">
				{children}
			</div>
		</TooltipTrigger>
		<TooltipContent side="bottom">
			<p>{label}</p>
		</TooltipContent>
	</Tooltip>
);

interface VitalProps {
	label: string;
	children: ReactNode;
}

const Vital = ({ label, children }: VitalProps) => (
	<span className="flex min-w-0 flex-col gap-0.5">
		<span className="gh-eyebrow">{label}</span>
		<span className="whitespace-nowrap font-mono text-xs tabular-nums">{children}</span>
	</span>
);

interface VitalsBandProps {
	sample: Sample;
	cpuHistory: number[];
	color: HostColor;
}

/** Live readings for a reachable host: the numbers, a CPU spark, the disk bar. */
const VitalsBand = ({ sample, cpuHistory, color }: VitalsBandProps) => {
	const diskPct =
		sample.diskUsedBytes !== null &&
		sample.diskTotalBytes !== null &&
		sample.diskTotalBytes > 0
			? (sample.diskUsedBytes / sample.diskTotalBytes) * 100
			: null;
	return (
		<div className="flex flex-col gap-2.5 rounded border border-border bg-background/40 p-3">
			<div className="flex flex-wrap gap-x-5 gap-y-2">
				<Vital label="cpu">
					{sample.cpuPercent === null ? "—" : `${sample.cpuPercent.toFixed(0)}%`}
					<span className="text-muted-foreground"> / {sample.cpuCount}c</span>
				</Vital>
				<Vital label="mem">
					{(sample.memUsedBytes / GIB).toFixed(1)}
					<span className="text-muted-foreground">
						{" "}
						/ {(sample.memTotalBytes / GIB).toFixed(0)} GiB
					</span>
				</Vital>
				<Vital label="load">
					{sample.loadAvg1 === null ? "—" : sample.loadAvg1.toFixed(2)}
				</Vital>
				<Vital label="up">
					{sample.uptimeSec === null ? "—" : formatUptime(sample.uptimeSec)}
				</Vital>
				<Vital label="ctrs">{sample.containerCount}</Vital>
			</div>
			<span className="block h-7">
				{cpuHistory.length < 2 ? (
					<Collecting className="h-full" hint="collecting cpu" />
				) : (
					<Spark data={cpuHistory} color={color} />
				)}
			</span>
			<span className="flex flex-col gap-1">
				<span className="flex items-baseline justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
					<span className="gh-eyebrow">disk</span>
					<span>
						{diskPct === null
							? "—"
							: `${diskPct.toFixed(0)}% · ${formatBytes(sample.diskUsedBytes ?? 0)} / ${formatBytes(sample.diskTotalBytes ?? 0)}`}
					</span>
				</span>
				<span className="h-1 w-full overflow-hidden rounded-full bg-muted">
					<span
						className="block h-full rounded-full transition-[width] duration-700"
						style={{
							width: `${diskPct ?? 0}%`,
							backgroundColor: hostCss(color),
							boxShadow: `0 0 6px ${hostCss(color, 0.5)}`,
						}}
					/>
				</span>
			</span>
		</div>
	);
};

interface ServerCardProps {
	server: ServerView;
	/** The fleet host polling this server's endpoint, when the viewer can read the fleet. */
	host: FleetHostView | undefined;
	state: ServerState;
	/** CPU % per fleet sample for the matched host; empty when there is none. */
	cpuHistory: number[];
	color: HostColor;
	isCloud: boolean;
	delay: number;
	/** The action strip — owned by the list so permissions and mutations stay in one place. */
	actions: ReactNode;
}

export const ServerCard = ({
	server,
	host,
	state,
	cpuHistory,
	color,
	isCloud,
	delay,
	actions,
}: ServerCardProps) => {
	const reduce = useReducedMotion();
	const isBuildServer = server.serverType === "build";
	// For a deduped registration the polled host carries the other name.
	const aliases = host
		? [host.name, ...host.aliases].filter((name) => name !== server.name)
		: [];

	return (
		<Reveal as="li" delay={delay} className="min-w-0">
			<motion.article
				whileHover={reduce ? undefined : { y: -2 }}
				transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
				className="gh-surface group relative flex h-full flex-col overflow-hidden rounded-lg"
			>
				<DitherGradient
					from={color}
					direction="left"
					cell={3}
					opacity={0.16}
					className="top-0 right-0 bottom-auto left-auto h-28 w-48 opacity-70 transition-opacity duration-300 [mask-image:linear-gradient(to_bottom,#000,transparent)] group-hover:opacity-100"
				/>

				<div className="relative flex flex-col gap-3 p-4">
					<div className="flex items-start justify-between gap-3">
						<div className="flex min-w-0 items-center gap-3">
							<span className="relative shrink-0">
								<DitherAvatar
									name={server.name}
									hue={hostHue(color)}
									size={36}
									bloom="low"
									className="rounded-[3px]"
								/>
								<span
									role="img"
									aria-label={STATE_LABEL[state]}
									title={STATE_LABEL[state]}
									className={cn(
										"absolute -right-1 -bottom-1 size-2.5 rounded-full ring-2 ring-card",
										state === "pending" && "animate-pulse",
									)}
									style={STATE_DOT[state]}
								/>
							</span>
							<div className="flex min-w-0 flex-col gap-0.5">
								<span className="flex min-w-0 items-baseline gap-2">
									<span className="truncate text-[15px] font-medium leading-tight">
										{server.name}
									</span>
									{state === "unreachable" && (
										<span className="shrink-0 rounded-sm bg-destructive/15 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-destructive">
											unreachable
										</span>
									)}
								</span>
								<span className="gh-eyebrow flex flex-wrap items-center gap-1.5 font-mono">
									<span className="normal-case">{server.ipAddress}</span>
									<span aria-hidden="true">·</span>
									<span className="tabular-nums">port {server.port}</span>
									<span aria-hidden="true">·</span>
									<span className="normal-case">{server.username}</span>
									<span aria-hidden="true">·</span>
									<span>ssh key {server.sshKeyId ? "yes" : "no"}</span>
									<span aria-hidden="true">·</span>
									<DateTooltip
										date={server.createdAt}
										className="font-mono text-inherit uppercase"
									>
										Created
									</DateTooltip>
								</span>
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-1.5 self-start">
							{isCloud &&
								(server.serverStatus === "active" ? (
									<span
										className={cn(
											chipClass,
											"border-primary/30 bg-primary/10 text-primary",
										)}
									>
										{server.serverStatus}
									</span>
								) : (
									<Tooltip delayDuration={0}>
										<TooltipTrigger asChild>
											<span
												className={cn(
													chipClass,
													"cursor-help border-destructive/30 bg-destructive/15 text-destructive",
												)}
											>
												{server.serverStatus}
											</span>
										</TooltipTrigger>
										<TooltipContent className="max-w-xs" side="bottom">
											<p className="text-sm">
												This server is deactivated due to lack of payment.
												Please pay your invoice to reactivate it. If you think
												this is an error, please contact support.
											</p>
										</TooltipContent>
									</Tooltip>
								))}
							<span
								className={cn(
									chipClass,
									isBuildServer
										? "border-border bg-muted text-muted-foreground"
										: "border-primary/30 bg-primary/10 text-primary",
								)}
							>
								{server.serverType}
							</span>
						</div>
					</div>

					{aliases.length > 0 && (
						<p
							className="truncate font-mono text-[11px] text-muted-foreground/70"
							title={`Also registered as ${aliases.join(", ")}`}
						>
							· also: {aliases.join(", ")}
						</p>
					)}

					{server.description && (
						<p className="line-clamp-2 text-sm text-muted-foreground">
							{server.description}
						</p>
					)}

					{host?.status.state === "online" ? (
						<VitalsBand
							sample={host.status.sample}
							cpuHistory={cpuHistory}
							color={color}
						/>
					) : host?.status.state === "unreachable" ? (
						<p
							className="break-words font-mono text-[11px] text-destructive/80"
							title={host.status.error}
						>
							{host.status.error}
						</p>
					) : state === "pending" ? (
						<Collecting className="h-9" hint="no vitals yet · run setup" />
					) : null}
				</div>

				{actions && (
					<div className="relative mt-auto border-t border-border px-4 py-3">
						{actions}
					</div>
				)}
			</motion.article>
		</Reveal>
	);
};
