// License operations are stubbed in this fork: no requests are sent to the
// license server. All keys are treated as valid locally.
export const validateLicenseKey = async (licenseKey: string) => {
	return true;
};

export const activateLicenseKey = async (licenseKey: string) => {
	return { success: true };
};

export const deactivateLicenseKey = async (licenseKey: string) => {
	return { success: true };
};
