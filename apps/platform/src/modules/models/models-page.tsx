import { Badge } from "@repo/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
import { groupByProvider, useModelsQuery } from "./hooks";

export function ModelsPage() {
  const query = useModelsQuery();
  const groups = groupByProvider(query.data?.data);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Available models</h1>
        <p className="text-sm text-muted-foreground">
          Aggregated across every provider that has an API key configured.
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !groups.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">No providers configured</CardTitle>
            <CardDescription>
              Set <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, <code>GOOGLE_API_KEY</code>, or{" "}
              <code>MISTRAL_API_KEY</code> in the gateway environment to enable models.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map(([provider, models]) => (
            <Card key={provider}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm font-medium">
                  <span className="capitalize">{provider}</span>
                  <Badge variant="secondary">{models.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {models.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2"
                  >
                    <code className="text-xs">{m.id}</code>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
