import { createFileRoute } from "@tanstack/react-router";
import { ServiceDocsPage } from "../modules/docs/docs-page";

export const Route = createFileRoute("/_authed/docs/services")({
  component: ServiceDocsPage,
});
