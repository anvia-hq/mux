import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/docs")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/docs" || location.pathname === "/docs/") {
      throw redirect({ to: "/docs/services" });
    }
  },
  component: DocsLayout,
});

function DocsLayout() {
  return <Outlet />;
}
