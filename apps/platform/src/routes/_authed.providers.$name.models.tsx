import { createFileRoute } from "@tanstack/react-router";
import { ProviderModelsPage } from "../modules/providers/provider-models-page";

export const Route = createFileRoute("/_authed/providers/$name/models")({
  component: ProviderModelsView,
});

function ProviderModelsView() {
  const { name } = Route.useParams();
  return <ProviderModelsPage provider={name} />;
}
