import type { QueryClient } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="flex gap-4 border-b border-neutral-800 p-4">
        <Link to="/" className="[&.active]:font-bold">
          Home
        </Link>
      </nav>
      <Outlet />
    </div>
  ),
});
