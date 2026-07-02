import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthPageShell } from "../modules/auth/components/auth-page-shell";
import { LoginForm } from "../modules/auth/components/login-form";
import { onboardingStatusQueryOptions } from "../modules/auth/hooks/use-auth";

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const status = await context.queryClient.ensureQueryData(onboardingStatusQueryOptions);
      if (status.needsOnboarding) {
        throw redirect({ to: "/onboard" });
      }
    } catch (error) {
      if (error instanceof Response) throw error;
      throw error;
    }
  },
  component: LoginRoute,
});

function LoginRoute() {
  return (
    <AuthPageShell>
      <LoginForm />
    </AuthPageShell>
  );
}
