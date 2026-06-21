import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/providers")({
  component: ProvidersLayout,
});

function ProvidersLayout() {
  return <Outlet />;
}
