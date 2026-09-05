import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { Hammer } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
	Collecting,
	Reveal,
} from "@/components/dashboard/monitoring/fleet/primitives";
import { DitherGradient } from "@/components/dither-kit";
import { DialogAction } from "@/components/shared/dialog-action";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const NONE = "none";

const schema = z
	.object({
		buildServerId: z.string(),
		registryId: z.string(),
	})
	.refine(
		(data) =>
			(data.buildServerId === NONE) === (data.registryId === NONE),
		{
			message:
				"Build Server and Build Registry must be selected together, or both set to None",
			path: ["buildServerId"],
		},
	);

type Schema = z.infer<typeof schema>;

export const ShowBuildDefaults = () => {
	const utils = api.useUtils();
	const { data: defaults, isPending } =
		api.organization.getBuildDefaults.useQuery();
	const { data: pendingCount } =
		api.organization.countApplicationsWithoutBuildServer.useQuery();
	const { data: buildServers } = api.server.buildServers.useQuery();
	const { data: registries } = api.registry.all.useQuery();

	const { mutateAsync: save, isPending: isSaving } =
		api.organization.setBuildDefaults.useMutation();
	const { mutateAsync: apply, isPending: isApplying } =
		api.organization.applyBuildDefaultsToExisting.useMutation();

	const form = useForm<Schema>({
		defaultValues: { buildServerId: NONE, registryId: NONE },
		resolver: zodResolver(schema),
	});

	useEffect(() => {
		if (defaults) {
			form.reset({
				buildServerId: defaults.buildServerId ?? NONE,
				registryId: defaults.registryId ?? NONE,
			});
		}
	}, [form, defaults]);

	const onSubmit = async (values: Schema) => {
		await save({
			buildServerId: values.buildServerId === NONE ? null : values.buildServerId,
			registryId: values.registryId === NONE ? null : values.registryId,
		})
			.then(async () => {
				toast.success("Build defaults updated");
				await utils.organization.getBuildDefaults.invalidate();
			})
			.catch((error: unknown) => {
				toast.error(
					error instanceof Error ? error.message : "Error updating build defaults",
				);
			});
	};

	const hasDefault = !!defaults?.buildServer && !!defaults?.registry;
	const count = pendingCount ?? 0;

	return (
		<div className="flex w-full flex-col gap-4 pb-10">
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
							<span className="gh-eyebrow">Settings · Build defaults</span>
							<h1 className="text-lg font-semibold tracking-tight">
								Build defaults
							</h1>
							<p className="max-w-prose text-sm text-muted-foreground">
								New applications in this organization start with this build
								server and registry. Any application can still override it
								from its own Build Server settings.
							</p>
						</div>
						{!isPending && (
							<span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
								<span
									aria-hidden
									className={cn(
										"size-1.5 rounded-full",
										hasDefault
											? "bg-primary shadow-[0_0_8px] shadow-primary/60"
											: "bg-muted-foreground",
									)}
								/>
								{hasDefault
									? `${defaults?.buildServer?.name} · ${defaults?.registry?.registryName}`
									: "No default set"}
							</span>
						)}
					</div>
				</header>
			</Reveal>

			{isPending ? (
				<Collecting
					className="min-h-[30vh] rounded-lg"
					hint="loading build defaults"
				/>
			) : (
				<>
					<Reveal delay={0.08}>
						<Card className="gh-surface">
							<CardHeader className="gap-1">
								<span className="gh-eyebrow">Defaults</span>
								<CardTitle className="text-sm font-medium">
									Build server and registry
								</CardTitle>
								<CardDescription>
									Both must be set together: images built on the build server
									are pushed to the registry, then pulled by the deployment
									server.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Form {...form}>
									<form
										onSubmit={form.handleSubmit(onSubmit)}
										className="grid w-full gap-4"
									>
										<div className="grid gap-4 sm:grid-cols-2">
											<FormField
												control={form.control}
												name="buildServerId"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Build Server</FormLabel>
														<Select
															onValueChange={(value) => {
																field.onChange(value);
																if (value === NONE) {
																	form.setValue("registryId", NONE);
																}
															}}
															value={field.value}
														>
															<FormControl>
																<SelectTrigger>
																	<SelectValue placeholder="Select a build server" />
																</SelectTrigger>
															</FormControl>
															<SelectContent>
																<SelectGroup>
																	<SelectItem value={NONE}>None</SelectItem>
																	{buildServers?.map((server) => (
																		<SelectItem
																			key={server.serverId}
																			value={server.serverId}
																		>
																			<span className="flex w-full items-center justify-between gap-2">
																				<span>{server.name}</span>
																				<span className="font-mono text-xs text-muted-foreground">
																					{server.ipAddress}
																				</span>
																			</span>
																		</SelectItem>
																	))}
																	<SelectLabel>
																		Build Servers ({buildServers?.length ?? 0})
																	</SelectLabel>
																</SelectGroup>
															</SelectContent>
														</Select>
														<FormDescription>
															{buildServers && buildServers.length === 0 ? (
																<>
																	No build servers yet. Add one with type
																	“Build” in{" "}
																	<Link
																		href="/dashboard/settings/servers"
																		className="text-primary underline-offset-4 hover:underline"
																	>
																		Servers
																	</Link>
																	.
																</>
															) : (
																"Only servers of type Build are listed."
															)}
														</FormDescription>
														<FormMessage />
													</FormItem>
												)}
											/>

											<FormField
												control={form.control}
												name="registryId"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Build Registry</FormLabel>
														<Select
															onValueChange={(value) => {
																field.onChange(value);
																if (value === NONE) {
																	form.setValue("buildServerId", NONE);
																}
															}}
															value={field.value}
														>
															<FormControl>
																<SelectTrigger>
																	<SelectValue placeholder="Select a registry" />
																</SelectTrigger>
															</FormControl>
															<SelectContent>
																<SelectGroup>
																	<SelectItem value={NONE}>None</SelectItem>
																	{registries?.map((registry) => (
																		<SelectItem
																			key={registry.registryId}
																			value={registry.registryId}
																		>
																			{registry.registryName}
																		</SelectItem>
																	))}
																	<SelectLabel>
																		Registries ({registries?.length ?? 0})
																	</SelectLabel>
																</SelectGroup>
															</SelectContent>
														</Select>
														<FormDescription>
															{registries && registries.length === 0 ? (
																<>
																	No registries yet. Add one in{" "}
																	<Link
																		href="/dashboard/settings/registry"
																		className="text-primary underline-offset-4 hover:underline"
																	>
																		Registry
																	</Link>
																	.
																</>
															) : (
																"Where images built on the build server are pushed."
															)}
														</FormDescription>
														<FormMessage />
													</FormItem>
												)}
											/>
										</div>

										<div className="flex w-full justify-end">
											<Button isLoading={isSaving} type="submit">
												Save
											</Button>
										</div>
									</form>
								</Form>
							</CardContent>
						</Card>
					</Reveal>

					<Reveal delay={0.16}>
						<Card className="gh-surface">
							<CardHeader className="gap-1">
								<span className="gh-eyebrow">Backfill</span>
								<CardTitle className="text-sm font-medium">
									Existing applications
								</CardTitle>
								<CardDescription>
									Defaults only apply to applications created from now on.
									Apply them once to every application that has no build
									server yet.
								</CardDescription>
							</CardHeader>
							<CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<span className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
									<Hammer className="size-3.5" aria-hidden />
									{count} application{count === 1 ? "" : "s"} without a build
									server
								</span>
								<DialogAction
									title="Apply build defaults"
									description={
										hasDefault
											? `Set ${defaults?.buildServer?.name} · ${defaults?.registry?.registryName} on ${count} application${count === 1 ? "" : "s"} that currently have no build server. Applications with a build server are left untouched.`
											: "Save a default build server and registry first."
									}
									type="default"
									disabled={!hasDefault || count === 0}
									onClick={async () => {
										await apply()
											.then(async ({ updated }) => {
												toast.success(
													`Applied build defaults to ${updated} application${updated === 1 ? "" : "s"}`,
												);
												await Promise.all([
													utils.organization.countApplicationsWithoutBuildServer.invalidate(),
													utils.application.invalidate(),
												]);
											})
											.catch((error: unknown) => {
												toast.error(
													error instanceof Error
														? error.message
														: "Error applying build defaults",
												);
											});
									}}
								>
									<Button
										variant="outline"
										size="sm"
										className="gh-interactive"
										isLoading={isApplying}
										disabled={!hasDefault || count === 0}
									>
										Apply to {count} app{count === 1 ? "" : "s"} without a build
										server
									</Button>
								</DialogAction>
							</CardContent>
						</Card>
					</Reveal>
				</>
			)}
		</div>
	);
};
