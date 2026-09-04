import { useState } from "react";
import { FleetCharts } from "./fleet/fleet-charts";
import { FleetHeader } from "./fleet/fleet-header";
import { HostRoster } from "./fleet/host-roster";
import { LocalDetail } from "./fleet/local-detail";
import { useFleet } from "./fleet/use-fleet";

/**
 * Fleet observability overview: one summary strip, one shared CPU chart and one
 * shared memory chart with every host as its own coloured series, a compact
 * host roster, and the local host's docker detail folded away underneath.
 * Selecting a host — from the chips, a chart series, or a roster row —
 * isolates it everywhere at once.
 */
export const ServersHealth = () => {
	const fleet = useFleet();
	const [selected, setSelected] = useState<string | null>(null);
	const [focus, setFocus] = useState<string | null>(null);

	// A host can drop out of the charts (no readings left in the window); an
	// isolation on it would dim everything, so treat it as "show all".
	const chartKeys = fleet.chartHosts.map((host) => host.key);
	const isolated =
		selected !== null && chartKeys.includes(selected) ? selected : null;
	const local = fleet.hosts[0];

	return (
		<div className="flex flex-col gap-4">
			<FleetHeader
				summary={fleet.summary}
				windowLabel={fleet.windowLabel}
				sampleCount={fleet.samples.length}
			/>
			<FleetCharts
				fleet={fleet}
				selected={isolated}
				focus={focus}
				onSelect={setSelected}
				onSpotlight={setFocus}
			/>
			<HostRoster
				hosts={fleet.hosts}
				chartKeys={chartKeys}
				selected={isolated}
				onSelect={setSelected}
				onSpotlight={setFocus}
			/>
			{local && <LocalDetail host={local} />}
		</div>
	);
};
