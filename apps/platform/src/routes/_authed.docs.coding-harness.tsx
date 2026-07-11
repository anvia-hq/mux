import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/docs/coding-harness")({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/docs",
      hash: location.hash.replace(/^#/, "") || "tool-integrations",
    });
  },
});
