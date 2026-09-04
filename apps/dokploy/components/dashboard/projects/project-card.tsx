import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { hostCss, hostHue } from "@/components/dashboard/monitoring/fleet/palette";
import { Reveal } from "@/components/dashboard/monitoring/fleet/primitives";
import {
	type DitherColor,
	DitherAvatar,
	DitherGradient,
} from "@/components/dither-kit";
import { DateTooltip } from "@/components/shared/date-tooltip";
import { TagBadge } from "@/components/shared/tag-badge";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/utils/api";

export type ProjectView = RouterOutputs["project"]["all"][number];
type EnvironmentView = ProjectView["environments"][number];

/**
 * Card wash colours, rotated by the project's position in the server order
 * (newest first) so a colour sticks to a project while the user sorts and
 * filters. Red is left out: it's reserved for the error dot.
 */
export const PROJECT_PALETTE = [
	"green",
	"blue",
	"purple",
	"pink",
	"orange",
] as const satisfies readonly DitherColor[];

export type ProjectColor = (typeof PROJECT_PALETTE)[number];

export const projectColorAt = (index: number): ProjectColor =>
	PROJECT_PALETTE[index % PROJECT_PALETTE.length] ?? "green";

/**
 * `applicationStatus` / `composeStatus` as Dokploy uses them: `done` is the
 * last deploy succeeded (the service is up), `running` is a deploy in flight,
 * `error` is a failed deploy, `idle` has never been deployed.
 */
export type ServiceStatus = "idle" | "running" | "done" | "error";

export interface ServiceHealth {
	key: string;
	name: string;
	kind: string;
	status: ServiceStatus;
}

/** Every service in an environment, flattened to one shape for the strip. */
export const collectServices = (env: EnvironmentView): ServiceHealth[] => [
	...env.applications.map((s) => ({
		key: s.applicationId,
		name: s.name,
		kind: "app",
		status: s.applicationStatus,
	})),
	...env.compose.map((s) => ({
		key: s.composeId,
		name: s.name,
		kind: "compose",
		status: s.composeStatus,
	})),
	...env.postgres.map((s) => ({
		key: s.postgresId,
		name: s.name,
		kind: "postgres",
		status: s.applicationStatus,
	})),
	...env.mysql.map((s) => ({
		key: s.mysqlId,
		name: s.name,
		kind: "mysql",
		status: s.applicationStatus,
	})),
	...env.mariadb.map((s) => ({
		key: s.mariadbId,
		name: s.name,
		kind: "mariadb",
		status: s.applicationStatus,
	})),
	...env.mongo.map((s) => ({
		key: s.mongoId,
		name: s.name,
		kind: "mongo",
		status: s.applicationStatus,
	})),
	...env.redis.map((s) => ({
		key: s.redisId,
		name: s.name,
		kind: "redis",
		status: s.applicationStatus,
	})),
	...env.libsql.map((s) => ({
		key: s.libsqlId,
		name: s.name,
		kind: "libsql",
		status: s.applicationStatus,
	})),
];

export type HealthCounts = Record<ServiceStatus, number>;

export const countHealth = (services: ServiceHealth[]): HealthCounts => {
	const counts: HealthCounts = { idle: 0, running: 0, done: 0, error: 0 };
	for (const s of services) counts[s.status] += 1;
	return counts;
};

/** Inline styles for a status dot; the healthy dot glows, deploying pulses. */
export const statusDot = (status: ServiceStatus) => {
	switch (status) {
		case "done":
			return {
				backgroundColor: hostCss("green"),
				boxShadow: `0 0 6px ${hostCss("green", 0.7)}`,
			};
		case "running":
			return {
				backgroundColor: hostCss("orange"),
				boxShadow: `0 0 6px ${hostCss("orange", 0.6)}`,
			};
		case "error":
			return { backgroundColor: "var(--destructive)" };
		default:
			return { backgroundColor: "var(--muted-foreground)", opacity: 0.45 };
	}
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
	done: "healthy",
	running: "deploying",
	error: "error",
	idle: "idle",
};

const MAX_DOTS = 24;
const MAX_ENV_CHIPS = 4;

interface HealthStripProps {
	services: ServiceHealth[];
	counts: HealthCounts;
}

/** One dot per service, coloured by deploy status; overflow collapses to +N. */
const HealthStrip = ({ services, counts }: HealthStripProps) => {
	const shown = services.slice(0, MAX_DOTS);
	const overflow = services.length - shown.length;
	const summary = (
		[
			counts.done > 0 && `${counts.done} healthy`,
			counts.running > 0 && `${counts.running} deploying`,
			counts.error > 0 && `${counts.error} error${counts.error === 1 ? "" : "s"}`,
			counts.idle > 0 && `${counts.idle} idle`,
		].filter(Boolean) as string[]
	).join(" · ");

	return (
		<div
			className="flex min-w-0 items-center justify-between gap-3"
			role="img"
			aria-label={summary ? `Services: ${summary}` : "No services"}
		>
			<span className="flex flex-wrap items-center gap-1">
				{shown.map((s) => (
					<span
						key={s.key}
						aria-hidden
						title={`${s.name} · ${s.kind} · ${STATUS_LABEL[s.status]}`}
						className={cn(
							"size-2 rounded-[2px]",
							s.status === "running" && "animate-pulse",
						)}
						style={statusDot(s.status)}
					/>
				))}
				{overflow > 0 && (
					<span
						aria-hidden
						className="ml-0.5 font-mono text-[10px] leading-none text-muted-foreground"
					>
						+{overflow}
					</span>
				)}
			</span>
			<span
				aria-hidden
				className="shrink-0 truncate font-mono text-[10px] tabular-nums text-muted-foreground"
			>
				{summary || "no services"}
			</span>
		</div>
	);
};

interface EnvChipsProps {
	environments: ProjectView["environments"];
}

/** Environment names as mono chips; the default environment is tinted. */
const EnvChips = ({ environments }: EnvChipsProps) => {
	const shown = environments.slice(0, MAX_ENV_CHIPS);
	const overflow = environments.length - shown.length;
	return (
		<ul
			className="flex flex-wrap items-center gap-1"
			aria-label="Environments"
		>
			{shown.map((env) => (
				<li
					key={env.environmentId}
					className={cn(
						"rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.04em]",
						env.isDefault
							? "border-primary/30 bg-primary/10 text-primary"
							: "border-border bg-muted/40 text-muted-foreground",
					)}
				>
					{env.name}
				</li>
			))}
			{overflow > 0 && (
				<li className="px-1 font-mono text-[10px] leading-none text-muted-foreground">
					+{overflow}
				</li>
			)}
		</ul>
	);
};

interface ProjectCardProps {
	project: ProjectView;
	color: ProjectColor;
	delay: number;
	/** The actions dropdown — owned by the list so mutations stay in one place. */
	actions: ReactNode;
}

export const ProjectCard = ({
	project,
	color,
	delay,
	actions,
}: ProjectCardProps) => {
	const reduce = useReducedMotion();
	const services = project.environments.flatMap(collectServices);
	const counts = countHealth(services);
	const envCount = project.environments.length;

	// Default environment first, else the first one the user can see.
	const accessibleEnvironment =
		project.environments.find((env) => env.isDefault) ??
		project.environments[0];
	const hasNoEnvironments = !accessibleEnvironment;

	return (
		<Reveal as="li" delay={delay} className="min-w-0">
			<Link
				href={
					hasNoEnvironments
						? "#"
						: `/dashboard/project/${project.projectId}/environment/${accessibleEnvironment.environmentId}`
				}
				onClick={(e) => {
					if (hasNoEnvironments) e.preventDefault();
				}}
				className="block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
			>
				<motion.article
					whileHover={reduce ? undefined : { y: -2 }}
					transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
					className="gh-surface gh-interactive group relative flex h-full flex-col overflow-hidden rounded-lg"
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
								<DitherAvatar
									name={project.name}
									hue={hostHue(color)}
									size={36}
									bloom="low"
									className="shrink-0 rounded-[3px]"
								/>
								<div className="flex min-w-0 flex-col gap-0.5">
									<span className="truncate text-[15px] font-medium leading-tight">
										{project.name}
									</span>
									<span className="gh-eyebrow flex flex-wrap items-center gap-1.5 text-muted-foreground">
										<DateTooltip
											date={project.createdAt}
											className="text-inherit"
										>
											Created
										</DateTooltip>
										<span aria-hidden="true">·</span>
										<span className="tabular-nums">
											{envCount} environment{envCount === 1 ? "" : "s"}
										</span>
										<span aria-hidden="true">·</span>
										<span className="tabular-nums">
											{services.length} service{services.length === 1 ? "" : "s"}
										</span>
									</span>
								</div>
							</div>
							<div className="flex shrink-0 self-start">{actions}</div>
						</div>

						{project.description && (
							<p className="line-clamp-2 text-sm text-muted-foreground">
								{project.description}
							</p>
						)}

						{project.projectTags && project.projectTags.length > 0 && (
							<div className="flex flex-wrap gap-1.5">
								{project.projectTags.map((pt) => (
									<TagBadge
										key={pt.tag.tagId}
										name={pt.tag.name}
										color={pt.tag.color}
									/>
								))}
							</div>
						)}

						{hasNoEnvironments && (
							<div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2">
								<AlertTriangle className="size-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
								<span className="text-xs text-yellow-600 dark:text-yellow-400">
									You have access to this project but no environments are
									available
								</span>
							</div>
						)}
					</div>

					<div className="relative mt-auto flex flex-col gap-2.5 border-t border-border px-4 py-3">
						<HealthStrip services={services} counts={counts} />
						{envCount > 0 && <EnvChips environments={project.environments} />}
					</div>
				</motion.article>
			</Link>
		</Reveal>
	);
};
