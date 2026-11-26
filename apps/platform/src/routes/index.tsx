import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { data, isPending, error } = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await fetch("/api/health")).json() as Promise<{ ok: boolean }>,
  });

  const status = getStatus(isPending, Boolean(error), data?.ok);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">mux</h1>
      <p className="mt-2 text-neutral-400">API: {status}</p>
    </main>
  );
}

function getStatus(isPending: boolean, hasError: boolean, ok?: boolean) {
  if (isPending) return "checking…";

  if (hasError) return "down";

  return ok ? "ok" : "down";
}
