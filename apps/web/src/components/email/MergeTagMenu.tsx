import { Braces } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BUILTIN_TAGS, SYSTEM_TAGS, attrTagKey, formatTag } from "@/lib/merge-tags";
import type { CustomField } from "@/types";

/** Insert a merge tag. Tags that can be empty are offered with a fallback so a blank name reads "Hi there". */
export function MergeTagMenu({ customFields, onInsert, size = "sm" }: { customFields: CustomField[]; onInsert: (tag: string) => void; size?: "sm" | "default" }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={size}>
          <Braces aria-hidden /> Merge tag
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel>Contact</DropdownMenuLabel>
        {BUILTIN_TAGS.map((t) => (
          <DropdownMenuItem key={t.key} onSelect={() => onInsert(formatTag(t.key, t.fallback))}>
            <span className="flex w-full items-baseline justify-between gap-3">
              <span>{t.label}</span>
              <span className="truncate text-xs text-muted-foreground">{t.example}</span>
            </span>
          </DropdownMenuItem>
        ))}
        {customFields.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Custom fields</DropdownMenuLabel>
            {customFields.map((f) => (
              <DropdownMenuItem key={f.key} onSelect={() => onInsert(formatTag(attrTagKey(f.key), ""))}>
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span>{f.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{attrTagKey(f.key)}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Links</DropdownMenuLabel>
        {SYSTEM_TAGS.map((t) => (
          <DropdownMenuItem key={t.key} onSelect={() => onInsert(formatTag(t.key))}>
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
