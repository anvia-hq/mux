import { createFileRoute } from "@tanstack/react-router";
import { PromptsPage } from "../modules/prompts/prompts-page";

export const Route = createFileRoute("/_authed/prompts")({
  component: PromptsPage,
});
