import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "../modules/docs/docs-page";

export const Route = createFileRoute("/_authed/docs")({
  component: DocsPage,
});
