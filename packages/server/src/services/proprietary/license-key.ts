import { db } from "@dokploy/server/db";
import {
	organization,
	organizationRole,
} from "@dokploy/server/db/schema";
import { and, eq } from "drizzle-orm";

export const hasValidLicense = async (organizationId: string) => {
	// Enterprise features are always unlocked in this fork; no DB or license server checks.
	return true;
};

export const resolveOrganizationDefaultRole = async (
	organizationId: string,
) => {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { defaultRole: true },
	});
	const defaultRole = org?.defaultRole;

	if (!defaultRole || defaultRole === "owner") {
		return "member";
	}

	if (defaultRole === "admin" || defaultRole === "member") {
		return defaultRole;
	}

	const customRole = await db.query.organizationRole.findFirst({
		where: and(
			eq(organizationRole.organizationId, organizationId),
			eq(organizationRole.role, defaultRole),
		),
		columns: { id: true },
	});

	if (!customRole || !(await hasValidLicense(organizationId))) {
		return "member";
	}

	return defaultRole;
};
