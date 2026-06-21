import { createFileRoute } from "@tanstack/react-router";
import { ProvidersList } from "../modules/providers/providers-page";

export const Route = createFileRoute("/_authed/providers/")({
  component: ProvidersList,
});