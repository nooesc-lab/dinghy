import { useEffect, useRef, useState } from "react";
import { FleetCharts } from "@/components/dashboard/monitoring/fleet/fleet-charts";
import { HostRoster } from "@/components/dashboard/monitoring/fleet/host-roster";
import type { Fleet } from "@/components/dashboard/monitoring/fleet/use-fleet";

interface FleetSectionProps {
	fleet: Fleet;
	delay: number;
}

/**
 * The `#fleet` landing: host chips, the shared CPU and memory charts, then the
 * roster. Selecting a host — from a chip, a chart series, or a roster row —
 * isolates it everywhere at once; the state lives here so a hover only
 * re-renders this section.
 */
export const FleetSection = ({ fleet, delay }: FleetSectionProps) => {
	const ref = useRef<HTMLElement>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [focus, setFocus] = useState<string | null>(null);

	// The section mounts after the permission query settles, which is after
	// the browser has already tried (and failed) to jump to a `#fleet` deep link.
	useEffect(() => {
		if (window.location.hash === "#fleet") ref.current?.scrollIntoView();
	}, []);

	// A host can drop out of the charts (no readings left in the window); an
	// isolation on it would dim everything, so treat it as "show all".
	const chartKeys = fleet.chartHosts.map((host) => host.key);
	const isolated =
		selected !== null && chartKeys.includes(selected) ? selected : null;

	return (
		<section
			ref={ref}
			id="fleet"
			className="flex scroll-mt-4 flex-col gap-4"
			aria-label="Fleet"
		>
			<FleetCharts
				fleet={fleet}
				selected={isolated}
				focus={focus}
				delay={delay}
				onSelect={setSelected}
				onSpotlight={setFocus}
			/>
			<HostRoster
				hosts={fleet.hosts}
				chartKeys={chartKeys}
				selected={isolated}
				delay={delay + 0.15}
				onSelect={setSelected}
				onSpotlight={setFocus}
			/>
		</section>
	);
};
