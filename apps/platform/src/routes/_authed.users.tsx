import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "../modules/users/users-page";

export const Route = createFileRoute("/_authed/users")({
  component: UsersPage,
});
