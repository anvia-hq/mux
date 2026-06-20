import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "../modules/dashboard/components/overview-page";

export const Route = createFileRoute("/_authed/")({
  component: OverviewPage,
});
