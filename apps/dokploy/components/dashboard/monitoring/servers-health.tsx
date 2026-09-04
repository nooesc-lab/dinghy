import type { ReactNode } from "react";
import { api } from "@/utils/api";

const GIB = 1024 ** 3;

const formatGiB = (bytes: number) => (bytes / GIB).toFixed(1);

const formatAgo = (iso: string) => {
	const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
	return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
};

interface ServerHealthRowProps {
	serverId?: string;
	name: string;
	ip: string;
}

const ServerHealthRow = ({ serverId, name, ip }: ServerHealthRowProps) => {
	const { data, error, isPending } = api.docker.getServerHealth.useQuery(
		serverId ? { serverId } : {},
		{
			refetchInterval: 45000,
			retry: false,
			refetchOnWindowFocus: false,
		},
	);

	const failure = error?.message ?? data?.error;

	let dotClass = "bg-muted-foreground animate-pulse";
	let status: ReactNode = "checking…";
	if (failure) {
		dotClass = "bg-destructive";
		status = <span title={failure}>unreachable</span>;
	} else if (data) {
		dotClass = "bg-primary shadow-[0_0_8px] shadow-primary/40";
		const { containers, resources } = data;
		status = (
			<>
				<span className="tabular-nums">
					{containers.containerCount} containers · {formatGiB(resources.memUsedBytes)}/
					{formatGiB(resources.memTotalBytes)} GiB · {resources.cpuCount} cpus
				</span>
				<span className="ml-3 text-muted-foreground/70">
					checked {formatAgo(data.checkedAt)}
				</span>
			</>
		);
	}

	return (
		<div className="gh-surface flex items-center gap-3 rounded-lg px-4 py-3">
			<span className={`size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
			<span className="min-w-0 truncate text-sm font-medium">{name}</span>
			<span className="truncate text-xs text-muted-foreground">{ip}</span>
			<span className="ml-auto shrink-0 text-right text-xs text-muted-foreground">
				{status}
			</span>
		</div>
	);
};

export const ServersHealth = () => {
	const { data: servers } = api.server.all.useQuery();

	return (
		<section className="space-y-3">
			<div className="flex flex-col gap-0.5">
				<span className="gh-eyebrow">Fleet</span>
				<h2 className="text-sm font-medium">Servers</h2>
			</div>
			<div className="flex flex-col gap-2">
				<ServerHealthRow name="Local" ip="Dinghy host" />
				{servers?.map((server) => (
					<ServerHealthRow
						key={server.serverId}
						serverId={server.serverId}
						name={server.name}
						ip={server.ipAddress}
					/>
				))}
			</div>
		</section>
	);
};
