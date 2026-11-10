import { Globe, Megaphone, Upload, UserPlus, type LucideIcon } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { NAV_GROUPS, canSee } from "@/components/layout/nav";
import { hasModule, useAuthStore } from "@/stores/auth-store";

interface QuickAction {
  label: string;
  path: string;
  icon: LucideIcon;
  module: string;
}

const ACTIONS: QuickAction[] = [
  { label: "New campaign", path: "/campaigns/new", icon: Megaphone, module: "campaigns" },
  { label: "Import contacts", path: "/import", icon: Upload, module: "audience" },
  { label: "Add a contact", path: "/contacts?new=1", icon: UserPlus, module: "audience" },
  { label: "Add a sending domain", path: "/domains?new=1", icon: Globe, module: "channels" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  const normalized = query.trim().toLowerCase();
  const match = (label: string) => !normalized || label.toLowerCase().includes(normalized);
  const actions = ACTIONS.filter((a) => hasModule(user, a.module) && match(a.label));
  const navItems = NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => canSee(user, item))
    .filter((item) => match(item.label));

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      title="Command palette"
      description="Jump to a page or start a common task"
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder="Jump to a page or start a task..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {actions.length > 0 ? (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem key={a.path} value={`action-${a.path}`} onSelect={() => go(a.path)}>
                <a.icon />
                {a.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {navItems.length > 0 ? (
          <>
            {actions.length > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading="Pages">
              {navItems.map((item) => (
                <CommandItem key={item.path} value={`nav-${item.path}`} onSelect={() => go(item.path)}>
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <kbd className="font-sans font-medium leading-none text-foreground">&uarr;&darr;</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="font-sans font-medium leading-none text-foreground">&crarr;</kbd>
            open
          </span>
        </div>
        <span className="flex items-center gap-1.5">
          <kbd className="font-sans font-medium leading-none text-foreground">esc</kbd>
          close
        </span>
      </div>
    </CommandDialog>
  );
}
