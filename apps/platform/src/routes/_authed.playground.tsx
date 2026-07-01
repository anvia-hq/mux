import { createFileRoute } from "@tanstack/react-router";
import { PlaygroundPage } from "../modules/playground/playground-page";

export const Route = createFileRoute("/_authed/playground")({
  component: PlaygroundPage,
});
