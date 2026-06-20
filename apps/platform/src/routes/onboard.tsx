import { createFileRoute, redirect } from "@tanstack/react-router";
import { OnboardingForm } from "../modules/auth/components/onboarding-form";
import { onboardingStatusQueryOptions } from "../modules/auth/hooks/use-auth";

export const Route = createFileRoute("/onboard")({
  beforeLoad: async ({ context }) => {
    try {
      const status = await context.queryClient.ensureQueryData(onboardingStatusQueryOptions);
      if (!status.needsOnboarding) {
        throw redirect({ to: "/login" });
      }
    } catch (error) {
      if (error instanceof Response) throw error;
      throw error;
    }
  },
  component: OnboardingForm,
});
