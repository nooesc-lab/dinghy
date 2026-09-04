import { KeyIcon, ServerIcon, Terminal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { hostColorAt } from "@/components/dashboard/monitoring/fleet/palette";
import {
	Collecting,
	Reveal,
} from "@/components/dashboard/monitoring/fleet/primitives";
import { useFleet } from "@/components/dashboard/monitoring/fleet/use-fleet";
import { DitherGradient } from "@/components/dither-kit";
import { AlertBlock } from "@/components/shared/alert-block";
import { DialogAction } from "@/components/shared/dialog-action";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { TerminalModal } from "../web-server/terminal-modal";
import { ShowServerActions } from "./actions/show-server-actions";
import { HandleServers } from "./handle-servers";
import {
	fleetHostFor,
	IconAction,
	ServerCard,
	serverStateOf,
} from "./server-card";
import { SetupServer } from "./setup-server";
import { ShowHealthModal } from "./show-health-modal";
import { ShowMonitoringModal } from "./show-monitoring-modal";
import { WelcomeSubscription } from "./welcome-stripe/welcome-subscription";

const setupHint = (
	<TooltipContent className="max-w-xs" side="bottom">
		<div className="space-y-1">
			<p className="font-semibold">Setup Server</p>
			<p className="text-xs text-muted-foreground">
				Configure and initialize your server with Docker, Traefik, and other
				essential services
			</p>
		</div>
	</TooltipContent>
);

export const ShowServers = () => {
	const router = useRouter();
	const query = router.query;
	const { data, refetch, isPending } = api.server.all.useQuery();
	const { mutateAsync } = api.server.remove.useMutation();
	const { data: sshKeys } = api.sshKey.all.useQuery();
	const { data: isCloud } = api.settings.isCloud.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();

	// What fleet.history itself checks.
	const canFleet = !!permissions?.docker.read && !!permissions?.server.read;
	const fleet = useFleet({ enabled: canFleet });

	const servers = data ?? [];
	const cards = servers.map((server, i) => {
		const host = canFleet ? fleetHostFor(fleet.hosts, server) : undefined;
		return {
			server,
			host,
			state: serverStateOf(server, host, canFleet),
			// The fleet colours remotes in registration order; a matched host
			// keeps that colour so the card agrees with Home's chips.
			color: host?.color ?? hostColorAt(i + 1),
		};
	});
	const reachable = cards.filter((card) => card.state === "online").length;
	const pending = cards.filter((card) => card.state === "pending").length;

	return (
		<div className="flex w-full flex-col gap-4 pb-10">
			{query?.success && isCloud && <WelcomeSubscription />}

			<Reveal>
				<header className="gh-surface relative overflow-hidden rounded-lg">
					<DitherGradient
						from="green"
						direction="right"
						cell={3}
						opacity={0.14}
						className="w-2/3"
					/>
					<div className="relative flex flex-wrap items-end justify-between gap-4 p-5">
						<div className="flex flex-col gap-0.5">
							<span className="gh-eyebrow">
								Servers
								{!isPending && (
									<span className="tabular-nums"> · {servers.length}</span>
								)}
							</span>
							<h1 className="text-lg font-semibold tracking-tight">
								{isPending
									? "Servers"
									: `${servers.length} server${servers.length === 1 ? "" : "s"}`}
							</h1>
							<p className="text-sm text-muted-foreground">
								Add servers to deploy your applications remotely.
								{isCloud && (
									<>
										{" "}
										<button
											type="button"
											className="font-mono text-[11px] text-primary underline-offset-4 hover:underline"
											onClick={() => {
												router.push("/dashboard/settings/servers?success=true");
											}}
										>
											Reset Onboarding
										</button>
									</>
								)}
							</p>
						</div>
						<div className="flex grow flex-col items-start gap-3 sm:items-end">
							{canFleet && !isPending && servers.length > 0 && (
								<span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
									<span
										aria-hidden
										className={cn(
											"size-1.5 rounded-full",
											reachable > 0
												? "animate-pulse bg-primary shadow-[0_0_8px] shadow-primary/60"
												: "bg-muted-foreground",
										)}
									/>
									<span className="tabular-nums">
										{reachable} reachable
										{pending > 0 && ` · ${pending} pending setup`}
									</span>
								</span>
							)}
							{permissions?.server.create && <HandleServers />}
						</div>
					</div>
				</header>
			</Reveal>

			{isPending ? (
				<Collecting className="min-h-[40vh] rounded-lg" hint="loading servers" />
			) : sshKeys?.length === 0 && servers.length === 0 ? (
				<Reveal delay={0.08}>
					<div className="gh-surface relative flex min-h-[40vh] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-lg">
						<DitherGradient from="grey" direction="up" cell={3} opacity={0.3} />
						<div className="relative flex flex-col items-center gap-4">
							<div className="rounded bg-muted p-3">
								<KeyIcon className="size-6 text-muted-foreground" />
							</div>
							<div className="flex flex-col items-center gap-1.5">
								<span className="text-[15px] font-medium">No SSH keys yet</span>
								<span className="gh-eyebrow text-muted-foreground">
									Add an SSH key to start adding servers
								</span>
							</div>
							<Link
								href="/dashboard/settings/ssh-keys"
								className="gh-interactive flex h-8 items-center gap-1.5 rounded border border-border px-2.5 font-mono text-[11px] text-primary"
							>
								Add SSH Key
							</Link>
						</div>
					</div>
				</Reveal>
			) : servers.length === 0 ? (
				<Reveal delay={0.08}>
					<div className="gh-surface relative flex min-h-[40vh] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-lg">
						<DitherGradient from="grey" direction="up" cell={3} opacity={0.3} />
						<div className="relative flex flex-col items-center gap-4">
							<div className="rounded bg-muted p-3">
								<ServerIcon className="size-6 text-muted-foreground" />
							</div>
							<div className="flex flex-col items-center gap-1.5">
								<span className="text-[15px] font-medium">No servers yet</span>
								<span className="gh-eyebrow text-muted-foreground">
									Start adding servers to deploy your applications remotely
								</span>
							</div>
							{permissions?.server.create && <HandleServers />}
						</div>
					</div>
				</Reveal>
			) : (
				<ul className="grid w-full grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
					{cards.map(({ server, host, state, color }, i) => {
						const canDelete = server.totalSum === 0;
						const isActive = server.serverStatus === "active";
						const isBuildServer = server.serverType === "build";
						const online = state === "online";
						const cpuHistory = host
							? fleet.samples.map(
									(sample) => sample.readings[host.key]?.cpu ?? 0,
								)
							: [];

						return (
							<ServerCard
								key={server.serverId}
								server={server}
								host={host}
								state={state}
								cpuHistory={cpuHistory}
								color={color}
								isCloud={!!isCloud}
								delay={0.08 + Math.min(i, 12) * 0.04}
								actions={
									isActive && (
										<div className="flex flex-col gap-2">
												{!online && (
													<Tooltip>
														<TooltipTrigger asChild>
															<div>
																<SetupServer serverId={server.serverId} />
															</div>
														</TooltipTrigger>
														{setupHint}
													</Tooltip>
												)}

												<div className="flex items-center gap-1">
													{online && (
														<Tooltip>
															<TooltipTrigger asChild>
																<div className="mr-1 [&>button]:size-8 [&>button]:rounded">
																	<SetupServer
																		serverId={server.serverId}
																		asButton={true}
																	/>
																</div>
															</TooltipTrigger>
															{setupHint}
														</Tooltip>
													)}

													{server.sshKeyId && permissions?.server.terminal && (
														<IconAction label="Terminal">
															<TerminalModal
																serverId={server.serverId}
																asButton={true}
															>
																<Button
																	variant="outline"
																	size="icon"
																	className="h-9 w-9"
																>
																	<Terminal className="h-4 w-4" />
																</Button>
															</TerminalModal>
														</IconAction>
													)}

													<IconAction label="Edit Server">
														<HandleServers
															serverId={server.serverId}
															asButton={true}
														/>
													</IconAction>

													{server.sshKeyId && !isBuildServer && (
														<IconAction label="Web Server Actions">
															<ShowServerActions
																serverId={server.serverId}
																asButton={true}
															/>
														</IconAction>
													)}

													{isCloud && server.sshKeyId && !isBuildServer && (
														<IconAction label="Monitoring">
															<ShowMonitoringModal
																url={`http://${server.ipAddress}:${server?.metricsConfig?.server?.port}/metrics`}
																token={server?.metricsConfig?.server?.token}
															/>
														</IconAction>
													)}

													{permissions?.docker.read &&
														permissions?.server.read &&
														server.sshKeyId &&
														!isBuildServer && (
															<IconAction label="Health">
																<ShowHealthModal serverId={server.serverId} />
															</IconAction>
														)}

													<div className="flex-1" />

													{permissions?.server.delete && (
														<Tooltip>
															<TooltipTrigger asChild>
																<div>
																	<DialogAction
																		disabled={!canDelete}
																		title={
																			canDelete
																				? "Delete Server"
																				: "Server has active services"
																		}
																		description={
																			canDelete ? (
																				"This will delete the server and all associated data"
																			) : (
																				<div className="flex flex-col gap-2">
																					You can not delete this server because
																					it has active services.
																					<AlertBlock type="warning">
																						You have active services associated
																						with this server, please delete them
																						first.
																					</AlertBlock>
																				</div>
																			)
																		}
																		onClick={async () => {
																			await mutateAsync({
																				serverId: server.serverId,
																			})
																				.then(() => {
																					refetch();
																					toast.success(
																						`Server ${server.name} deleted successfully`,
																					);
																				})
																				.catch((err) => {
																					toast.error(err.message);
																				});
																		}}
																	>
																		<Button
																			variant="outline"
																			size="icon"
																			className={cn(
																				"size-8 rounded",
																				canDelete
																					? "border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/30 dark:hover:bg-destructive/10"
																					: "text-muted-foreground",
																			)}
																		>
																			<Trash2 className="h-4 w-4" />
																		</Button>
																	</DialogAction>
																</div>
															</TooltipTrigger>
															<TooltipContent side="bottom">
																<p>
																	{canDelete
																		? "Delete Server"
																		: "Cannot delete - has active services"}
																</p>
															</TooltipContent>
														</Tooltip>
													)}
												</div>
										</div>
									)
								}
							/>
						);
					})}
				</ul>
			)}
		</div>
	);
};
