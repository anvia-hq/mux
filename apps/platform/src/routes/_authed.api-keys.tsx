import { createFileRoute } from "@tanstack/react-router";
import { ApiKeysPage } from "../modules/api-keys/api-keys-page";

export const Route = createFileRoute("/_authed/api-keys")({
  component: ApiKeysPage,
});
