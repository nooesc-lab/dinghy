import { useId, useMemo } from "react";
import { type DitherColor, DitherGradient } from "@/components/dither-kit";
import { PALETTE, rgb } from "@/components/dither-kit/palette";
import { hostCss } from "./palette";
import { Collecting, Reveal } from "./primitives";
import { type FleetSummary, MAX_SAMPLES, POLL_MS } from "./use-fleet";

interface TileProps {
	label: string;
	value: string;
	sub: string;
	color: DitherColor;
	history: number[];
	delay: number;
}

const SPARK_W = 120;
const SPARK_H = 28;

/**
 * Stroke-only sparkline: y-range fit to the data (min→max with padding) so a
 * steady metric reads as a flat line, not a filled slab. Last point gets a dot.
 */
const Spark = ({ data, color }: { data: number[]; color: DitherColor }) => {
	const glowId = useId();
	const { path, last } = useMemo(() => {
		const lo = Math.min(...data);
		const hi = Math.max(...data);
		const span = hi - lo || 1;
		const pad = 3;
		const step = SPARK_W / (data.length - 1);
		const pts = data.map((v, i) => [
			i * step,
			SPARK_H - pad - ((v - lo) / span) * (SPARK_H - pad * 2),
		]);
		return {
			path: pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(""),
			last: pts[pts.length - 1] ?? [0, 0],
		};
	}, [data]);
	const stroke = rgb(PALETTE[color].line);
	return (
		<svg
			viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
			preserveAspectRatio="none"
			className="h-full w-full overflow-visible"
			aria-hidden
		>
			<defs>
				<filter id={glowId} x="-10%" y="-50%" width="120%" height="200%">
					<feGaussianBlur stdDeviation="1.6" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>
			<path
				d={path}
				fill="none"
				stroke={hostCss(color, 0.45)}
				strokeWidth={2.5}
				vectorEffect="non-scaling-stroke"
				filter={`url(#${glowId})`}
			/>
			<path
				d={path}
				fill="none"
				stroke={stroke}
				strokeWidth={1.25}
				strokeLinejoin="round"
				strokeLinecap="round"
				vectorEffect="non-scaling-stroke"
			/>
			<circle cx={last[0]} cy={last[1]} r={1.6} fill={stroke} />
		</svg>
	);
};

const Tile = ({ label, value, sub, color, history, delay }: TileProps) => (
	<Reveal delay={delay} className="flex flex-col bg-card">
		<div className="flex flex-col gap-1 px-4 pt-4">
			<span className="gh-eyebrow">{label}</span>
			<span className="text-xl font-semibold tabular-nums tracking-tight">
				{value}
			</span>
			<span className="text-[11px] text-muted-foreground">{sub}</span>
		</div>
		<div className="mt-3 h-9 w-full px-4 pb-2">
			{history.length < 2 ? (
				<Collecting className="h-full" hint="collecting" />
			) : (
				<Spark data={history} color={color} />
			)}
		</div>
	</Reveal>
);

interface FleetHeaderProps {
	summary: FleetSummary;
	windowLabel: string;
	sampleCount: number;
}

export const FleetHeader = ({
	summary,
	windowLabel,
	sampleCount,
}: FleetHeaderProps) => {
	const down = summary.total - summary.online;
	const memPct =
		summary.memTotalGiB > 0
			? (summary.memUsedGiB / summary.memTotalGiB) * 100
			: null;

	return (
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
					<div className="flex flex-wrap items-end justify-between gap-3">
						<div className="flex flex-col gap-0.5">
							<span className="gh-eyebrow">Fleet</span>
							<h1 className="text-lg font-semibold tracking-tight">
								Monitoring
							</h1>
							<p className="text-sm text-muted-foreground">
								Live health across your servers
							</p>
						</div>
						<div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
							<span
								aria-hidden
								className="size-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_8px] shadow-primary/60"
							/>
							<span className="tabular-nums">
								{windowLabel} · {sampleCount}/{MAX_SAMPLES} samples · every{" "}
								{POLL_MS / 1000}s
							</span>
						</div>
					</div>

					<div className="grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
						<Tile
							label="Hosts online"
							value={`${summary.online} / ${summary.total}`}
							sub={
								down > 0
									? `${down} unreachable`
									: summary.total === 0
										? "no hosts"
										: "all reachable"
							}
							color="green"
							history={summary.history.online}
							delay={0.05}
						/>
						<Tile
							label="Containers"
							value={String(summary.containers)}
							sub={`across ${summary.online} host${summary.online === 1 ? "" : "s"}`}
							color="blue"
							history={summary.history.containers}
							delay={0.1}
						/>
						<Tile
							label="CPU · fleet average"
							value={
								summary.cpuAvg === null ? "—" : `${summary.cpuAvg.toFixed(0)}%`
							}
							sub="mean of reporting hosts"
							color="orange"
							history={summary.history.cpuAvg}
							delay={0.15}
						/>
						<Tile
							label="Memory · fleet"
							value={`${summary.memUsedGiB.toFixed(1)} / ${summary.memTotalGiB.toFixed(1)} GiB`}
							sub={memPct === null ? "—" : `${memPct.toFixed(0)}% in use`}
							color="purple"
							history={summary.history.memUsedGiB}
							delay={0.2}
						/>
					</div>
				</div>
			</header>
		</Reveal>
	);
};
