export const LICENSE_KEY_URL =
	// process.env.NODE_ENV === "development"
	// 	? "http://localhost:4002"
	"https://licenses-api.dokploy.com";

export const initEnterpriseBackupCronJobs = async () => {
	// License validation cron is disabled in this fork: never contacts the
	// license server, so keys can never be auto-revoked.
};

export const validateLicenseKey = async (licenseKey: string) => {
	// Stubbed: every key validates locally without contacting the license server.
	return true;
};
