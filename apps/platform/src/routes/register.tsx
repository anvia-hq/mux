import { createFileRoute, redirect } from "@tanstack/react-router";
import { onboardingStatusQueryOptions } from "../modules/auth/hooks/use-auth";

export const Route = createFileRoute("/register")({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(onboardingStatusQueryOptions);
    throw redirect({ to: status.needsOnboarding ? "/onboard" : "/login" });
  },
  component: RegisterRoute,
});

function RegisterRoute() {
  return null;
}
