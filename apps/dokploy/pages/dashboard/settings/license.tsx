// The license settings page is removed in this fork: enterprise is always
// unlocked, so visiting the page redirects to the profile settings instead.
const Page = () => {
	return null;
};

export default Page;

export async function getServerSideProps() {
	return {
		redirect: {
			permanent: false,
			destination: "/dashboard/settings/profile",
		},
	};
}
