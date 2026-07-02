import { createFileRoute } from "@tanstack/react-router";
import { RedemptionsPage } from "../modules/redemptions/redemptions-page";

export const Route = createFileRoute("/_authed/redemptions")({
  component: RedemptionsPage,
});
