import * as React from "react";
import { Navigate, Outlet } from "react-router-dom";

import { CommandPalette } from "@/components/command/CommandPalette";
import { SideNav } from "@/components/layout/SideNav";
import { TopBar } from "@/components/layout/TopBar";
import { useAuthStore } from "@/stores/auth-store";

interface ShellContextValue {
  openPalette: () => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

/**
 * Access shell-level actions (command palette) from any page
 * rendered inside the AppShell.
 */
export function useShell(): ShellContextValue {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within AppShell");
  return ctx;
}

export default function AppShell() {
  const token = useAuthStore((s) => s.token);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const shell = React.useMemo<ShellContextValue>(
    () => ({
      openPalette: () => setPaletteOpen(true),
    }),
    [],
  );

  // No session on a protected route: back to sign-in.
  if (!token) return <Navigate to="/login" replace />;

  return (
    <ShellContext.Provider value={shell}>
      <div className="min-h-screen bg-background">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <TopBar />
        <div className="flex">
          <SideNav />
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1200px]">
              <Outlet />
            </div>
          </main>
        </div>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </ShellContext.Provider>
  );
}
