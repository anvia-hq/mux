import { createFileRoute } from "@tanstack/react-router";
import { CodingHarnessDocsPage } from "../modules/docs/docs-page";

export const Route = createFileRoute("/_authed/docs/coding-harness")({
  component: CodingHarnessDocsPage,
});
