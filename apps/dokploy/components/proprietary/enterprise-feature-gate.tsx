"use client";

interface EnterpriseFeatureLockedProps {
	/** Optional title override */
	title?: string;
	/** Optional description override */
	description?: string;
	/** Optional custom CTA label */
	ctaLabel?: string;
	/** Optional CTA href (default: /dashboard/settings/license) */
	ctaHref?: string;
	/** Compact variant (less padding, smaller icon) */
	compact?: boolean;
}

/**
 * Displays a locked state for enterprise features when the user has no valid license.
 * Use standalone or via EnterpriseFeatureGate.
 */
export function EnterpriseFeatureLocked({
	title = "Enterprise feature",
	description = "This feature is part of Dokploy Enterprise. Add a valid license to use it.",
	ctaLabel = "Go to License",
	ctaHref = "/dashboard/settings/license",
	compact = false,
}: EnterpriseFeatureLockedProps) {
	// Enterprise is always unlocked in this fork; the locked state never renders.
	return null;
}

interface EnterpriseFeatureGateProps {
	children: React.ReactNode;
	/** Props for the locked state when license is invalid */
	lockedProps?: Omit<EnterpriseFeatureLockedProps, "compact">;
	/** Show loading spinner while checking license */
	fallback?: React.ReactNode;
}

/**
 * Renders children only when the instance has a valid enterprise license.
 * Otherwise shows EnterpriseFeatureLocked.
 */
export function EnterpriseFeatureGate({
	children,
	lockedProps,
	fallback,
}: EnterpriseFeatureGateProps) {
	// Enterprise is always unlocked in this fork: children render unconditionally.
	return <>{children}</>;
}
