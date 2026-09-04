import {
	Ban,
	CheckCircle2,
	Hammer,
	RefreshCcw,
	Rocket,
	Terminal,
} from "lucide-react";
import { useRouter } from "next/router";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { toast } from "sonner";
import { ShowBuildChooseForm } from "@/components/dashboard/application/build/show";
import { ShowProviderForm } from "@/components/dashboard/application/general/generic/show";
import { DialogAction } from "@/components/shared/dialog-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";
import { DockerTerminalModal } from "../../settings/web-server/docker-terminal-modal";

interface Props {
	applicationId: string;
}

export const ShowGeneralApplication = ({ applicationId }: Props) => {
	const router = useRouter();
	const { data: permissions } = api.user.getPermissions.useQuery();
	const canDeploy = permissions?.deployment.create ?? false;
	const canUpdateService = permissions?.service.create ?? false;
	const { data, refetch } = api.application.one.useQuery(
		{
			applicationId,
		},
		{ enabled: !!applicationId },
	);
	const { mutateAsync: update } = api.application.update.useMutation();
	const { mutateAsync: start, isPending: isStarting } =
		api.application.start.useMutation();
	const { mutateAsync: stop, isPending: isStopping } =
		api.application.stop.useMutation();

	const { mutateAsync: deploy } = api.application.deploy.useMutation();

	const { mutateAsync: reload, isPending: isReloading } =
		api.application.reload.useMutation();

	const { mutateAsync: redeploy } = api.application.redeploy.useMutation();

	return (
		<>
			<Card className="gh-surface">
				<CardHeader className="gap-1">
					<span className="gh-eyebrow">Actions</span>
					<CardTitle className="text-sm font-medium">Deploy Settings</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
					<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap">
						<TooltipProvider delayDuration={0} disableHoverableContent={false}>
							{canDeploy && (
								<DialogAction
									title="Deploy Application"
									description="Are you sure you want to deploy this application?"
									type="default"
									onClick={async () => {
										await deploy({
											applicationId: applicationId,
										})
											.then(() => {
												toast.success("Application deployed successfully");
												refetch();
												router.push(
													`/dashboard/project/${data?.environment.projectId}/environment/${data?.environmentId}/services/application/${applicationId}?tab=deployments`,
												);
											})
											.catch(() => {
												toast.error("Error deploying application");
											});
									}}
								>
									<Button
										variant="default"
										size="sm"
										isLoading={data?.applicationStatus === "running"}
										className="gh-interactive flex items-center gap-1.5 group"
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="flex items-center">
													<Rocket className="size-4 mr-1" />
													Deploy
												</div>
											</TooltipTrigger>
											<TooltipPrimitive.Portal>
												<TooltipContent sideOffset={5} className="z-60">
													<p>
														Downloads the source code and performs a complete
														build
													</p>
												</TooltipContent>
											</TooltipPrimitive.Portal>
										</Tooltip>
									</Button>
								</DialogAction>
							)}
							{canDeploy && (
								<DialogAction
									title="Reload Application"
									description="Are you sure you want to reload this application?"
									type="default"
									onClick={async () => {
										await reload({
											applicationId: applicationId,
											appName: data?.appName || "",
										})
											.then(() => {
												toast.success("Application reloaded successfully");
												refetch();
											})
											.catch(() => {
												toast.error("Error reloading application");
											});
									}}
								>
									<Button
										variant="outline"
										size="sm"
										isLoading={isReloading}
										className="gh-interactive flex items-center gap-1.5 group"
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="flex items-center">
													<RefreshCcw className="size-4 mr-1" />
													Reload
												</div>
											</TooltipTrigger>
											<TooltipPrimitive.Portal>
												<TooltipContent sideOffset={5} className="z-60">
													<p>Reload the application without rebuilding it</p>
												</TooltipContent>
											</TooltipPrimitive.Portal>
										</Tooltip>
									</Button>
								</DialogAction>
							)}
							{canDeploy && (
								<DialogAction
									title="Rebuild Application"
									description="Are you sure you want to rebuild this application?"
									type="default"
									onClick={async () => {
										await redeploy({
											applicationId: applicationId,
										})
											.then(() => {
												toast.success("Application rebuilt successfully");
												refetch();
											})
											.catch(() => {
												toast.error("Error rebuilding application");
											});
									}}
								>
									<Button
										variant="outline"
										size="sm"
										isLoading={data?.applicationStatus === "running"}
										className="gh-interactive flex items-center gap-1.5 group"
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="flex items-center">
													<Hammer className="size-4 mr-1" />
													Rebuild
												</div>
											</TooltipTrigger>
											<TooltipPrimitive.Portal>
												<TooltipContent sideOffset={5} className="z-60">
													<p>
														Only rebuilds the application without downloading new
														code
													</p>
												</TooltipContent>
											</TooltipPrimitive.Portal>
										</Tooltip>
									</Button>
								</DialogAction>
							)}
	
							{canDeploy && data?.applicationStatus === "idle" ? (
								<DialogAction
									title="Start Application"
									description="Are you sure you want to start this application?"
									type="default"
									onClick={async () => {
										await start({
											applicationId: applicationId,
										})
											.then(() => {
												toast.success("Application started successfully");
												refetch();
											})
											.catch(() => {
												toast.error("Error starting application");
											});
									}}
								>
									<Button
										variant="outline"
										size="sm"
										isLoading={isStarting}
										className="gh-interactive flex items-center gap-1.5 group"
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="flex items-center">
													<CheckCircle2 className="size-4 mr-1" />
													Start
												</div>
											</TooltipTrigger>
											<TooltipPrimitive.Portal>
												<TooltipContent sideOffset={5} className="z-60">
													<p>
														Start the application (requires a previous successful
														build)
													</p>
												</TooltipContent>
											</TooltipPrimitive.Portal>
										</Tooltip>
									</Button>
								</DialogAction>
							) : canDeploy ? (
								<DialogAction
									title="Stop Application"
									description="Are you sure you want to stop this application?"
									onClick={async () => {
										await stop({
											applicationId: applicationId,
										})
											.then(() => {
												toast.success("Application stopped successfully");
												refetch();
											})
											.catch(() => {
												toast.error("Error stopping application");
											});
									}}
								>
									<Button
										variant="outline"
										size="sm"
										isLoading={isStopping}
										className="gh-interactive flex items-center gap-1.5 group border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/40"
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="flex items-center">
													<Ban className="size-4 mr-1" />
													Stop
												</div>
											</TooltipTrigger>
											<TooltipPrimitive.Portal>
												<TooltipContent sideOffset={5} className="z-60">
													<p>Stop the currently running application</p>
												</TooltipContent>
											</TooltipPrimitive.Portal>
										</Tooltip>
									</Button>
								</DialogAction>
							) : null}
						</TooltipProvider>
						<DockerTerminalModal
							appName={data?.appName || ""}
							serverId={data?.serverId || ""}
							serviceId={applicationId}
						>
							<Button
								variant="ghost"
								size="sm"
								className="gh-interactive flex items-center gap-1.5 col-span-2"
							>
								<Terminal className="size-4 mr-1" />
								Open Terminal
							</Button>
						</DockerTerminalModal>
					</div>
					{canUpdateService && (
						<div className="flex flex-row flex-wrap items-center gap-2 lg:justify-end">
							<div className="flex h-9 flex-row items-center gap-3 rounded-md border border-border px-3">
								<span className="gh-eyebrow">Autodeploy</span>
								<Switch
									aria-label="Toggle autodeploy"
									checked={data?.autoDeploy || false}
									onCheckedChange={async (enabled) => {
										await update({
											applicationId,
											autoDeploy: enabled,
										})
											.then(async () => {
												toast.success("Auto Deploy Updated");
												await refetch();
											})
											.catch(() => {
												toast.error("Error updating Auto Deploy");
											});
									}}
								/>
							</div>
							<div className="flex h-9 flex-row items-center gap-3 rounded-md border border-border px-3">
								<span className="gh-eyebrow">Clean Cache</span>
								<Switch
									aria-label="Toggle clean cache"
									checked={data?.cleanCache || false}
									onCheckedChange={async (enabled) => {
										await update({
											applicationId,
											cleanCache: enabled,
										})
											.then(async () => {
												toast.success("Clean Cache Updated");
												await refetch();
											})
											.catch(() => {
												toast.error("Error updating Clean Cache");
											});
									}}
								/>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
			<ShowProviderForm applicationId={applicationId} />
			<ShowBuildChooseForm applicationId={applicationId} />
		</>
	);
};
