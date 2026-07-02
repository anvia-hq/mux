import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "../modules/dashboard/components/app-shell";
import { meQueryOptions } from "../modules/auth/hooks/use-auth";
import { ApiError, UnauthorizedError } from "../lib/api-client";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQueryOptions);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw redirect({ to: "/login", search: { redirect: location.href } });
      }
      // Any 401 from the server means the session is gone or invalid - force
      // re-login instead of mounting an empty shell.
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: "/login", search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return <AppShell />;
}
