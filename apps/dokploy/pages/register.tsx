import { IS_CLOUD, isAdminPresent, validateRequest } from "@dokploy/server";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { SignInWithGithub } from "@/components/proprietary/auth/sign-in-with-github";
import { SignInWithGoogle } from "@/components/proprietary/auth/sign-in-with-google";
import { SignupShowcase } from "@/components/proprietary/auth/signup-showcase";
import { AlertBlock } from "@/components/shared/alert-block";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription } from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { pushToDataLayer } from "@/lib/analytics";
import { authClient } from "@/lib/auth-client";
import { useWhitelabelingPublic } from "@/utils/hooks/use-whitelabeling";

const registerSchema = z
	.object({
		name: z.string().min(1, {
			message: "First name is required",
		}),
		lastName: z.string().min(1, {
			message: "Last name is required",
		}),
		email: z
			.string()
			.min(1, {
				message: "Email is required",
			})
			.email({
				message: "Email must be a valid email",
			}),
		password: z
			.string()
			.min(1, {
				message: "Password is required",
			})
			.refine((password) => password === "" || password.length >= 8, {
				message: "Password must be at least 8 characters",
			}),
		confirmPassword: z
			.string()
			.min(1, {
				message: "Password is required",
			})
			.refine(
				(confirmPassword) =>
					confirmPassword === "" || confirmPassword.length >= 8,
				{
					message: "Password must be at least 8 characters",
				},
			),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type Register = z.infer<typeof registerSchema>;

interface Props {
	hasAdmin: boolean;
	isCloud: boolean;
}

const Register = ({ isCloud }: Props) => {
	const router = useRouter();
	const { config: whitelabeling } = useWhitelabelingPublic();
	const [isError, setIsError] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [data, setData] = useState<any>(null);

	const form = useForm<Register>({
		defaultValues: {
			name: "",
			lastName: "",
			email: "",
			password: "",
			confirmPassword: "",
		},
		resolver: zodResolver(registerSchema),
	});

	useEffect(() => {
		form.reset();
	}, [form, form.reset, form.formState.isSubmitSuccessful]);

	const onSubmit = async (values: Register) => {
		const { data, error } = await authClient.signUp.email({
			email: values.email,
			password: values.password,
			name: values.name,
			lastName: values.lastName,
		});

		if (error) {
			setIsError(true);
			setError(error.message || "An error occurred");
		} else {
			toast.success("User registered successfully", {
				duration: 2000,
			});
			if (!isCloud) {
				router.push("/");
			} else {
				pushToDataLayer("sign_up", { method: "email" });
				setData(data);
			}
		}
	};
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col items-center gap-4 text-center">
				<div className="flex flex-col items-center gap-2">
					<Link href="/">
						<Logo
							className="size-10"
							logoUrl={
								whitelabeling?.loginLogoUrl ||
								whitelabeling?.logoUrl ||
								undefined
							}
						/>
					</Link>
					<span className="text-base font-semibold tracking-tight">
						{whitelabeling?.appName || "Dinghy"}
					</span>
					<p className="gh-eyebrow">Little boat. Big ships.</p>
				</div>
				<div className="space-y-1">
					<h1 className="text-lg font-semibold tracking-tight">
						{isCloud ? "Sign Up" : "Setup the server"}
					</h1>
					<CardDescription>
						Enter your email and password to{" "}
						{isCloud ? "create an account" : "setup the server"}
					</CardDescription>
				</div>
			</div>
			<div className="w-full">
						{isError && (
							<AlertBlock
								type="error"
								className="my-2 border border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/10 dark:text-destructive"
							>
								<span>{error}</span>
							</AlertBlock>
						)}
						{isCloud && data && (
							<AlertBlock type="success" className="my-2">
								<span>
									Registered successfully, please check your inbox or spam
									folder to confirm your account.
								</span>
							</AlertBlock>
						)}
						<CardContent className="p-0">
							{isCloud && (
								<div className="flex flex-col gap-2">
									<SignInWithGithub />
									<SignInWithGoogle />
								</div>
							)}
							{isCloud && (
								<p className="gh-eyebrow my-4 text-center">
									Or register with email
								</p>
							)}
							<Form {...form}>
								<form
									method="post"
									onSubmit={form.handleSubmit(onSubmit)}
									className="grid gap-4"
								>
									<div className="space-y-4">
										<FormField
											control={form.control}
											name="name"
											render={({ field }) => (
												<FormItem>
													<FormLabel className="text-xs text-muted-foreground">
														First Name
													</FormLabel>
													<FormControl>
														<Input className="h-9" placeholder="John" {...field} />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										<FormField
											control={form.control}
											name="lastName"
											render={({ field }) => (
												<FormItem>
													<FormLabel className="text-xs text-muted-foreground">
														Last Name
													</FormLabel>
													<FormControl>
														<Input className="h-9" placeholder="Doe" {...field} />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										<FormField
											control={form.control}
											name="email"
											render={({ field }) => (
												<FormItem>
													<FormLabel className="text-xs text-muted-foreground">
														Email
													</FormLabel>
													<FormControl>
														<Input
															className="h-9"
															placeholder="email@dokploy.com"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										<FormField
											control={form.control}
											name="password"
											render={({ field }) => (
												<FormItem>
													<FormLabel className="text-xs text-muted-foreground">
														Password
													</FormLabel>
													<FormControl>
														<Input
															className="h-9"
															type="password"
															placeholder="Password"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="confirmPassword"
											render={({ field }) => (
												<FormItem>
													<FormLabel className="text-xs text-muted-foreground">
														Confirm Password
													</FormLabel>
													<FormControl>
														<Input
															className="h-9"
															type="password"
															placeholder="Password"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										<Button
											type="submit"
											isLoading={form.formState.isSubmitting}
											className="w-full"
										>
											Register
										</Button>
									</div>
								</form>
							</Form>
							<div className="mt-6 flex flex-row flex-wrap justify-between gap-2 text-xs text-muted-foreground">
								{isCloud && (
									<div className="flex gap-1">
										Already have account?
										<Link
											className="transition-colors hover:text-foreground"
											href="/"
										>
											Sign in
										</Link>
									</div>
								)}

								<div className="flex gap-1">
									Need help?
									<Link
										className="transition-colors hover:text-foreground"
										href="https://dokploy.com"
										target="_blank"
									>
										Contact us
									</Link>
								</div>
							</div>
						</CardContent>
			</div>
		</div>
	);
};

export default Register;

Register.getLayout = (page: ReactElement) => {
	const isCloud = (page.props as Props).isCloud;
	return (
		<OnboardingLayout leftPanel={isCloud ? <SignupShowcase /> : undefined}>
			{page}
		</OnboardingLayout>
	);
};
export async function getServerSideProps(context: GetServerSidePropsContext) {
	if (IS_CLOUD) {
		const { user } = await validateRequest(context.req);

		if (user) {
			return {
				redirect: {
					permanent: false,
					destination: "/dashboard/home",
				},
			};
		}
		return {
			props: {
				isCloud: true,
			},
		};
	}
	const hasAdmin = await isAdminPresent();

	if (hasAdmin) {
		return {
			redirect: {
				permanent: false,
				destination: "/",
			},
		};
	}
	return {
		props: {
			isCloud: false,
		},
	};
}
