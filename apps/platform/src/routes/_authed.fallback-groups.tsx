import { createFileRoute } from "@tanstack/react-router";
import { FallbackGroupsPage } from "../modules/fallback-groups/fallback-groups-page";

export const Route = createFileRoute("/_authed/fallback-groups")({
  component: FallbackGroupsPage,
});
