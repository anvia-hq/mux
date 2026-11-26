import { createFileRoute } from "@tanstack/react-router";
import { ExecutionsLogPanel } from "@/modules/playground/components/executions-log-panel";

export const Route = createFileRoute("/logs")({ component: ExecutionsLogPanel });
