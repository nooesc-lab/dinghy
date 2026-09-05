import { db } from "@dokploy/server/db";
import {
	applications,
	environments,
	organization,
	projects,
	registry,
	server,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { and, count, eq, inArray, isNull } from "drizzle-orm";

export interface OrganizationBuildDefaults {
	buildServerId: string | null;
	registryId: string | null;
}

export const findOrganizationBuildDefaults = async (organizationId: string) => {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { defaultBuildServerId: true, defaultRegistryId: true },
		with: {
			defaultBuildServer: {
				columns: {
					serverId: true,
					name: true,
					ipAddress: true,
					serverType: true,
				},
			},
			defaultRegistry: {
				columns: { registryId: true, registryName: true },
			},
		},
	});
	if (!org) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Organization not found",
		});
	}
	return {
		buildServerId: org.defaultBuildServerId,
		registryId: org.defaultRegistryId,
		buildServer: org.defaultBuildServer,
		registry: org.defaultRegistry,
	};
};

export const updateOrganizationBuildDefaults = async (
	organizationId: string,
	input: OrganizationBuildDefaults,
) => {
	if ((input.buildServerId === null) !== (input.registryId === null)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"Build server and build registry must be set together, or both cleared",
		});
	}

	if (input.buildServerId) {
		const buildServer = await db.query.server.findFirst({
			where: and(
				eq(server.serverId, input.buildServerId),
				eq(server.organizationId, organizationId),
			),
			columns: { serverType: true },
		});
		if (!buildServer) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Build server not found in this organization",
			});
		}
		if (buildServer.serverType !== "build") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "The selected server is not a build server",
			});
		}
	}

	if (input.registryId) {
		const buildRegistry = await db.query.registry.findFirst({
			where: and(
				eq(registry.registryId, input.registryId),
				eq(registry.organizationId, organizationId),
			),
			columns: { registryId: true },
		});
		if (!buildRegistry) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Registry not found in this organization",
			});
		}
	}

	await db
		.update(organization)
		.set({
			defaultBuildServerId: input.buildServerId,
			defaultRegistryId: input.registryId,
		})
		.where(eq(organization.id, organizationId));
};

/**
 * Organization build defaults that apply to a new application in the given
 * environment, or null when the organization has none configured.
 */
export const findBuildDefaultsForEnvironment = async (
	environmentId: string,
) => {
	const row = await db
		.select({
			buildServerId: organization.defaultBuildServerId,
			registryId: organization.defaultRegistryId,
		})
		.from(environments)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.innerJoin(organization, eq(projects.organizationId, organization.id))
		.where(eq(environments.environmentId, environmentId))
		.then((rows) => rows[0]);

	if (!row?.buildServerId || !row.registryId) {
		return null;
	}
	return { buildServerId: row.buildServerId, registryId: row.registryId };
};

const applicationsWithoutBuildServer = (organizationId: string) =>
	db
		.select({ applicationId: applications.applicationId })
		.from(applications)
		.innerJoin(
			environments,
			eq(applications.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(
				eq(projects.organizationId, organizationId),
				isNull(applications.buildServerId),
			),
		);

export const countApplicationsWithoutBuildServer = async (
	organizationId: string,
) => {
	const row = await db
		.select({ count: count() })
		.from(applicationsWithoutBuildServer(organizationId).as("candidates"))
		.then((rows) => rows[0]);
	return row?.count ?? 0;
};

/**
 * Backfills the organization's build defaults onto every application in the
 * organization that has no build server. Returns the number of applications
 * updated.
 */
export const applyBuildDefaultsToApplications = async (
	organizationId: string,
) => {
	const defaults = await findOrganizationBuildDefaults(organizationId);
	if (!defaults.buildServerId || !defaults.registryId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This organization has no build defaults configured",
		});
	}

	const updated = await db
		.update(applications)
		.set({
			buildServerId: defaults.buildServerId,
			buildRegistryId: defaults.registryId,
		})
		.where(
			inArray(
				applications.applicationId,
				applicationsWithoutBuildServer(organizationId),
			),
		)
		.returning({ applicationId: applications.applicationId });

	return updated.length;
};
