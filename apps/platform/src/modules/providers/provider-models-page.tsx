import { Link } from "@tanstack/react-router";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Switch } from "@repo/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import {
  PROVIDER_LABELS,
  type ProviderName,
  useProviderModelsQuery,
  useToggleModelMutation,
  useEnableAllMutation,
  useDisableAllMutation,
} from "./hooks";

export function ProviderModelsPage({ provider }: { provider: ProviderName }) {
  const query = useProviderModelsQuery(provider);
  const toggle = useToggleModelMutation(provider);
  const enableAll = useEnableAllMutation(provider);
  const disableAll = useDisableAllMutation(provider);
  const models = query.data?.data ?? [];

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{PROVIDER_LABELS[provider]}</h1>
          <p className="text-sm text-muted-foreground">
            <Link to="/providers" className="underline underline-offset-4 hover:text-foreground">
              Providers
            </Link>{" "}
            &rarr; Manage models. Disabled models won't appear on the models page.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => enableAll.mutate()}
            disabled={enableAll.isPending || disableAll.isPending}
          >
            {enableAll.isPending ? "Enabling..." : "Enable all"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => disableAll.mutate()}
            disabled={enableAll.isPending || disableAll.isPending}
          >
            {disableAll.isPending ? "Disabling..." : "Disable all"}
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>Model</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell />
                  <TableCell>
                    <code className="text-xs font-medium">{m.id}</code>
                    <div className="text-xs text-muted-foreground">{m.name}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={m.enabled}
                        onCheckedChange={(checked) =>
                          toggle.mutate({ modelId: m.id, enabled: checked })
                        }
                        disabled={toggle.isPending}
                      />
                      <Badge variant={m.enabled ? "default" : "secondary"}>
                        {m.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
