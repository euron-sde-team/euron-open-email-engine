import { Image as ImageIcon, Link2, MousePointerClick } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { MergeTagMenu } from "@/components/email/MergeTagMenu";
import { insertAtCursor } from "@/lib/merge-tags";
import type { CustomField } from "@/types";

const SNIPPETS = {
  link: '<a href="https://example.com" style="color:#ab1757">Link text</a>',
  button:
    '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ab1757;border-radius:6px"><a href="https://example.com" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:600;text-decoration:none">Button label</a></td></tr></table>',
  image: '<img src="https://example.com/image.png" alt="Describe the image" width="560" style="max-width:100%;height:auto;display:block">',
};

/** A plain HTML textarea with a toolbar that inserts at the caret: merge tags and a few blocks. */
export function HtmlEditor({
  id,
  value,
  onChange,
  customFields,
  rows = 22,
  label = "HTML",
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  customFields: CustomField[];
  rows?: number;
  label?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const insert = (text: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = insertAtCursor(value, start, end, text);
    onChange(next.text);
    // Restore focus and caret once React has written the new value.
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <MergeTagMenu customFields={customFields} onInsert={insert} />
          <Button type="button" variant="ghost" size="sm" onClick={() => insert(SNIPPETS.link)}>
            <Link2 aria-hidden /> Link
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => insert(SNIPPETS.button)}>
            <MousePointerClick aria-hidden /> Button
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => insert(SNIPPETS.image)}>
            <ImageIcon aria-hidden /> Image
          </Button>
        </div>
      </div>
      <textarea
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="block w-full resize-y rounded-md border border-input bg-card p-3 font-mono text-[13px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
