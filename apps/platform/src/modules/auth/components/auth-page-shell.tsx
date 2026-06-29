import type { ReactNode } from "react";
import muxLogoUrl from "../../../assets/logo-mux.png";

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="grid w-full max-w-md gap-4">
        <div className="flex h-10 items-center justify-center gap-2 text-sm font-semibold tracking-normal">
          <img
            src={muxLogoUrl}
            alt=""
            aria-hidden="true"
            className="size-[1.875rem] shrink-0 rounded-[6px] object-cover"
          />
          <span>Mux Gateway</span>
        </div>
        {children}
      </div>
    </div>
  );
}
