import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/docs/services")({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/docs",
      ...(location.hash ? { hash: location.hash.replace(/^#/, "") } : {}),
    });
  },
});
