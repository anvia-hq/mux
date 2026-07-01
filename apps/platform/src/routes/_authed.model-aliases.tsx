import { createFileRoute } from "@tanstack/react-router";
import { ModelAliasesPage } from "../modules/model-aliases/model-aliases-page";

export const Route = createFileRoute("/_authed/model-aliases")({
  component: ModelAliasesPage,
});
