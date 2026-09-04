import type { GetServerSideProps } from "next";

/**
 * The fleet view now lives on Home. Keeps old bookmarks and deep links working;
 * Home applies its own auth and permission gates on arrival.
 */
export const getServerSideProps: GetServerSideProps = async () => ({
	redirect: {
		permanent: false,
		destination: "/dashboard/home#fleet",
	},
});

const Monitoring = () => null;

export default Monitoring;
