import { createFileRoute } from "@tanstack/react-router";
import { LogsPage } from "../modules/logs/logs-page";

export const Route = createFileRoute("/_authed/logs")({
  component: LogsPage,
});
