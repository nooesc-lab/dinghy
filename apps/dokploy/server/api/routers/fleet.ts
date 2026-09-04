import {
	FLEET_MAX_SAMPLES,
	FLEET_POLL_MS,
	type FleetHostState,
	getFleetSnapshot,
	IS_CLOUD,
	LOCAL_HOST_KEY,
} from "@dokploy/server";
import { checkPermission } from "@dokploy/server/services/permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";

type FleetHistoryHost = Pick<
	FleetHostState["meta"],
	"hostKey" | "serverId" | "name" | "aliases" | "ipAddress"
> &
	Pick<FleetHostState, "status" | "error" | "latest" | "samples">;

export const fleetRouter = createTRPCRouter({
	// Same host-level data as docker.getServerHealth, so same docker.read + server.read gate.
	history: protectedProcedure.query(async ({ ctx }) => {
		await checkPermission(ctx, { docker: ["read"], server: ["read"] });
		const orgId = ctx.session.activeOrganizationId;
		const hosts: FleetHistoryHost[] = [];
		for (const state of getFleetSnapshot().values()) {
			const { meta } = state;
			const isLocal = meta.hostKey === LOCAL_HOST_KEY;
			if (isLocal ? IS_CLOUD : !meta.organizationIds.includes(orgId)) {
				continue;
			}
			hosts.push({
				hostKey: meta.hostKey,
				serverId: meta.serverId,
				name: meta.name,
				aliases: meta.aliases,
				ipAddress: meta.ipAddress,
				status: state.status,
				error: state.error,
				latest: state.latest,
				samples: state.samples,
			});
		}
		return { pollMs: FLEET_POLL_MS, maxSamples: FLEET_MAX_SAMPLES, hosts };
	}),
});
