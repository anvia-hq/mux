import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthPageShell } from "../modules/auth/components/auth-page-shell";
import { RegisterForm } from "../modules/auth/components/register-form";
import { onboardingStatusQueryOptions } from "../modules/auth/hooks/use-auth";

export const Route = createFileRoute("/register")({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(onboardingStatusQueryOptions);
    if (status.needsOnboarding) {
      throw redirect({ to: "/onboard" });
    }
  },
  component: RegisterRoute,
});

function RegisterRoute() {
  return (
    <AuthPageShell>
      <RegisterForm />
    </AuthPageShell>
  );
}
