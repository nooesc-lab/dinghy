import {
	AlertTriangle,
	ArrowUpDown,
	FolderInput,
	MoreHorizontalIcon,
	Search,
	TrashIcon,
} from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Collecting, Reveal } from "@/components/dashboard/monitoring/fleet/primitives";
import { DitherGradient } from "@/components/dither-kit";
import { BreadcrumbSidebar } from "@/components/shared/breadcrumb-sidebar";
import { FocusShortcutInput } from "@/components/shared/focus-shortcut-input";
import { TagFilter } from "@/components/shared/tag-filter";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";
import { useDebounce } from "@/utils/hooks/use-debounce";
import { HandleProject } from "./handle-project";
import {
	collectServices,
	countHealth,
	type HealthCounts,
	ProjectCard,
	type ProjectColor,
	projectColorAt,
	statusDot,
} from "./project-card";
import { ProjectEnvironment } from "./project-environment";

const plural = (n: number, word: string) =>
	`${n} ${word}${n === 1 ? "" : "s"}`;

/** Healthy · deploying · errors, as glowing dots — the header's live readout. */
const HealthReadout = ({ counts }: { counts: HealthCounts }) => {
	const entries = [
		{ status: "done" as const, n: counts.done, label: "healthy" },
		{ status: "running" as const, n: counts.running, label: "deploying" },
		{ status: "error" as const, n: counts.error, label: "error" },
	].filter((e) => e.n > 0);
	if (entries.length === 0) return null;
	return (
		<dl className="flex items-center gap-4 font-mono text-[11px] text-muted-foreground">
			{entries.map((e) => (
				<div key={e.status} className="flex items-center gap-1.5">
					<dt className="sr-only">{e.label}</dt>
					<span
						aria-hidden
						className="size-1.5 rounded-full"
						style={statusDot(e.status)}
					/>
					<dd className="tabular-nums">
						{e.n} {e.label}
					</dd>
				</div>
			))}
		</dl>
	);
};

export const ShowProjects = () => {
	const utils = api.useUtils();
	const router = useRouter();
	const { data: isCloud } = api.settings.isCloud.useQuery();
	const { data, isPending } = api.project.all.useQuery();
	const { data: auth } = api.user.get.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();
	const { mutateAsync } = api.project.remove.useMutation();
	const { data: availableTags } = api.tag.all.useQuery();

	const [searchQuery, setSearchQuery] = useState(
		router.isReady && typeof router.query.q === "string" ? router.query.q : "",
	);
	const debouncedSearchQuery = useDebounce(searchQuery, 500);

	const [sortBy, setSortBy] = useState<string>(() => {
		if (typeof window !== "undefined") {
			return localStorage.getItem("projectsSort") || "createdAt-desc";
		}
		return "createdAt-desc";
	});

	const [selectedTagIds, setSelectedTagIds] = useState<string[]>(() => {
		if (typeof window !== "undefined") {
			const saved = localStorage.getItem("projectsTagFilter");
			return saved ? JSON.parse(saved) : [];
		}
		return [];
	});

	useEffect(() => {
		localStorage.setItem("projectsSort", sortBy);
	}, [sortBy]);

	useEffect(() => {
		localStorage.setItem("projectsTagFilter", JSON.stringify(selectedTagIds));
	}, [selectedTagIds]);

	useEffect(() => {
		if (!availableTags) return;
		const validIds = new Set(availableTags.map((t) => t.tagId));
		setSelectedTagIds((prev) => {
			const filtered = prev.filter((id) => validIds.has(id));
			return filtered.length === prev.length ? prev : filtered;
		});
	}, [availableTags]);

	useEffect(() => {
		if (!router.isReady) return;
		const urlQuery = typeof router.query.q === "string" ? router.query.q : "";
		if (urlQuery !== searchQuery) {
			setSearchQuery(urlQuery);
		}
	}, [router.isReady, router.query.q]);

	useEffect(() => {
		if (!router.isReady) return;
		const urlQuery = typeof router.query.q === "string" ? router.query.q : "";
		if (debouncedSearchQuery === urlQuery) return;

		const newQuery = { ...router.query };
		if (debouncedSearchQuery) {
			newQuery.q = debouncedSearchQuery;
		} else {
			delete newQuery.q;
		}
		router.replace({ pathname: router.pathname, query: newQuery }, undefined, {
			shallow: true,
		});
	}, [debouncedSearchQuery]);

	const filteredProjects = useMemo(() => {
		if (!data) return [];

		let filtered = data.filter(
			(project) =>
				project.name
					.toLowerCase()
					.includes(debouncedSearchQuery.toLowerCase()) ||
				project.description
					?.toLowerCase()
					.includes(debouncedSearchQuery.toLowerCase()),
		);

		// Filter by selected tags (OR logic: show projects with ANY selected tag)
		if (selectedTagIds.length > 0) {
			filtered = filtered.filter((project) =>
				project.projectTags?.some((pt) =>
					selectedTagIds.includes(pt.tag.tagId),
				),
			);
		}

		// Then sort the filtered results
		const [field, direction] = sortBy.split("-");
		return [...filtered].sort((a, b) => {
			let comparison = 0;
			switch (field) {
				case "name":
					comparison = a.name.localeCompare(b.name);
					break;
				case "createdAt":
					comparison =
						new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
					break;
				case "services": {
					const aTotalServices = a.environments.reduce((total, env) => {
						return (
							total +
							(env.applications?.length || 0) +
							(env.libsql?.length || 0) +
							(env.mariadb?.length || 0) +
							(env.mongo?.length || 0) +
							(env.mysql?.length || 0) +
							(env.postgres?.length || 0) +
							(env.redis?.length || 0) +
							(env.compose?.length || 0)
						);
					}, 0);
					const bTotalServices = b.environments.reduce((total, env) => {
						return (
							total +
							(env.applications?.length || 0) +
							(env.libsql?.length || 0) +
							(env.mariadb?.length || 0) +
							(env.mongo?.length || 0) +
							(env.mysql?.length || 0) +
							(env.postgres?.length || 0) +
							(env.redis?.length || 0) +
							(env.compose?.length || 0)
						);
					}, 0);
					comparison = aTotalServices - bTotalServices;
					break;
				}
				default:
					comparison = 0;
			}
			return direction === "asc" ? comparison : -comparison;
		});
	}, [data, debouncedSearchQuery, sortBy, selectedTagIds]);

	// Colour follows server order (newest first) so it survives sort/filter.
	const colorOf = useMemo(() => {
		const byId: Record<string, ProjectColor> = {};
		(data ?? []).forEach((project, i) => {
			byId[project.projectId] = projectColorAt(i);
		});
		return byId;
	}, [data]);

	const fleet = useMemo(() => {
		const projects = data ?? [];
		const services = projects.flatMap((p) =>
			p.environments.flatMap(collectServices),
		);
		return {
			projects: projects.length,
			environments: projects.reduce((n, p) => n + p.environments.length, 0),
			services: services.length,
			counts: countHealth(services),
		};
	}, [data]);

	return (
		<>
			<BreadcrumbSidebar
				list={[{ name: "Projects", href: "/dashboard/projects" }]}
			/>
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
								<span className="gh-eyebrow">
									Projects
									{!isPending && (
										<span className="tabular-nums"> · {fleet.projects}</span>
									)}
								</span>
								<h1 className="text-lg font-semibold tracking-tight">
									{isPending ? "Projects" : plural(fleet.projects, "project")}
								</h1>
								<p className="text-sm text-muted-foreground">
									{isPending
										? "Create and manage your projects"
										: fleet.projects === 0
											? "Create and manage your projects"
											: `${plural(fleet.services, "service")} across ${plural(fleet.environments, "environment")}`}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-4">
								{!isPending && <HealthReadout counts={fleet.counts} />}
								{permissions?.project.create && <HandleProject />}
							</div>
						</div>
					</header>
				</Reveal>

				{isPending ? (
					<Collecting className="min-h-[50vh] rounded-lg" hint="loading projects" />
				) : (
					<>
						<Reveal delay={0.08}>
							<div className="flex w-full items-center gap-3 max-sm:flex-col">
								<div className="relative flex-1 max-sm:w-full">
									<FocusShortcutInput
										placeholder="Filter projects..."
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										className="pr-10"
									/>
									<Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
								</div>
								<div className="flex items-center gap-2 max-sm:w-full">
									<TagFilter
										tags={
											availableTags?.map((tag) => ({
												id: tag.tagId,
												name: tag.name,
												color: tag.color || undefined,
											})) || []
										}
										selectedTags={selectedTagIds}
										onTagsChange={setSelectedTagIds}
									/>
									<div className="flex min-w-48 items-center gap-2 max-sm:w-full">
										<ArrowUpDown className="size-4 text-muted-foreground" />
										<Select value={sortBy} onValueChange={setSortBy}>
											<SelectTrigger className="w-full">
												<SelectValue placeholder="Sort by..." />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="name-asc">Name (A-Z)</SelectItem>
												<SelectItem value="name-desc">Name (Z-A)</SelectItem>
												<SelectItem value="createdAt-desc">
													Newest first
												</SelectItem>
												<SelectItem value="createdAt-asc">
													Oldest first
												</SelectItem>
												<SelectItem value="services-desc">
													Most services
												</SelectItem>
												<SelectItem value="services-asc">
													Least services
												</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</div>
							</div>
						</Reveal>

						{filteredProjects.length === 0 && (
							<Reveal delay={0.12}>
								<div className="gh-surface relative flex min-h-[50vh] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-lg">
									<DitherGradient
										from="grey"
										direction="up"
										cell={3}
										opacity={0.3}
									/>
									<div className="relative flex flex-col items-center gap-4">
										<div className="rounded bg-muted p-3">
											<FolderInput className="size-6 text-muted-foreground" />
										</div>
										<div className="flex flex-col items-center gap-1.5">
											<span className="text-[15px] font-medium">
												{data?.length === 0
													? "No projects yet"
													: "No projects found"}
											</span>
											<span className="gh-eyebrow text-muted-foreground">
												{data?.length === 0
													? "Create your first project to get started"
													: "Try adjusting your search or filters"}
											</span>
										</div>
										{data?.length === 0 && permissions?.project.create && (
											<HandleProject />
										)}
									</div>
								</div>
							</Reveal>
						)}

						<ul className="grid w-full grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
							{filteredProjects.map((project, i) => {
								const emptyServices = project.environments
									.map(
										(env) =>
											env.applications.length === 0 &&
											env.compose.length === 0 &&
											env.libsql.length === 0 &&
											env.mariadb.length === 0 &&
											env.mongo.length === 0 &&
											env.mysql.length === 0 &&
											env.postgres.length === 0 &&
											env.redis.length === 0,
									)
									.every(Boolean);

								return (
									<ProjectCard
										key={project.projectId}
										project={project}
										color={colorOf[project.projectId] ?? "green"}
										delay={0.12 + Math.min(i, 12) * 0.04}
										actions={
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														className="size-8 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
														aria-label={`Actions for ${project.name}`}
													>
														<MoreHorizontalIcon className="size-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent
													className="w-[200px] space-y-2 overflow-y-auto max-h-[280px]"
													onClick={(e) => e.stopPropagation()}
												>
													<DropdownMenuLabel className="font-normal">
														Actions
													</DropdownMenuLabel>
													<div onClick={(e) => e.stopPropagation()}>
														<ProjectEnvironment projectId={project.projectId} />
													</div>
													<div onClick={(e) => e.stopPropagation()}>
														<HandleProject projectId={project.projectId} />
													</div>

													<div onClick={(e) => e.stopPropagation()}>
														{permissions?.project.delete && (
															<AlertDialog>
																<AlertDialogTrigger className="w-full">
																	<DropdownMenuItem
																		className="w-full cursor-pointer  space-x-3"
																		onSelect={(e) => e.preventDefault()}
																	>
																		<TrashIcon className="size-4" />
																		<span>Delete</span>
																	</DropdownMenuItem>
																</AlertDialogTrigger>
																<AlertDialogContent>
																	<AlertDialogHeader>
																		<AlertDialogTitle>
																			Are you sure to delete this project?
																		</AlertDialogTitle>
																		{!emptyServices ? (
																			<div className="flex flex-row gap-4 rounded-lg bg-yellow-50 p-2 dark:bg-yellow-950">
																				<AlertTriangle className="text-yellow-600 dark:text-yellow-400" />
																				<span className="text-sm text-yellow-600 dark:text-yellow-400">
																					You have active services, please delete
																					them first
																				</span>
																			</div>
																		) : (
																			<AlertDialogDescription>
																				This action cannot be undone
																			</AlertDialogDescription>
																		)}
																	</AlertDialogHeader>
																	<AlertDialogFooter>
																		<AlertDialogCancel>Cancel</AlertDialogCancel>
																		<AlertDialogAction
																			disabled={!emptyServices}
																			onClick={async () => {
																				await mutateAsync({
																					projectId: project.projectId,
																				})
																					.then(() => {
																						toast.success(
																							"Project deleted successfully",
																						);
																					})
																					.catch(() => {
																						toast.error(
																							"Error deleting this project",
																						);
																					})
																					.finally(() => {
																						utils.project.all.invalidate();
																					});
																			}}
																		>
																			Delete
																		</AlertDialogAction>
																	</AlertDialogFooter>
																</AlertDialogContent>
															</AlertDialog>
														)}
													</div>
												</DropdownMenuContent>
											</DropdownMenu>
										}
									/>
								);
							})}
						</ul>
					</>
				)}
			</div>
		</>
	);
};
