import { createFileRoute } from "@tanstack/react-router";
import { ProvidersPage } from "../modules/providers/providers-page";

export const Route = createFileRoute("/_authed/providers")({
  component: ProvidersPage,
});
