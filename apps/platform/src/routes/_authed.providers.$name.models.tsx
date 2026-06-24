import { createFileRoute } from "@tanstack/react-router";
import { ProviderModelsPage } from "../modules/providers/provider-models-page";
import { PROVIDER_NAMES } from "../modules/providers/hooks";

export const Route = createFileRoute("/_authed/providers/$name/models")({
  component: ProviderModelsView,
});

function ProviderModelsView() {
  const { name } = Route.useParams();
  if (!PROVIDER_NAMES.includes(name as (typeof PROVIDER_NAMES)[number])) {
    return <p className="p-4 text-sm text-muted-foreground">Unknown provider.</p>;
  }
  return <ProviderModelsPage provider={name as (typeof PROVIDER_NAMES)[number]} />;
}
