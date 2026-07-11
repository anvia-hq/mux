import { createFileRoute } from "@tanstack/react-router";
import { DocumentationPage } from "../modules/docs/docs-page";

export const Route = createFileRoute("/_authed/docs")({
  component: DocumentationPage,
});
