import { createFileRoute } from "@tanstack/react-router";
import { ModelsPage } from "../modules/models/models-page";

export const Route = createFileRoute("/_authed/models")({
  component: ModelsPage,
});
