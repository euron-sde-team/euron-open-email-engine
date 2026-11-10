import { Monitor, Smartphone } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The CSP applied inside the preview: nothing runs, no network except images and fonts.
 * Together with an empty `sandbox` attribute (no scripts, no same-origin, no forms, no
 * top navigation) the author's HTML cannot touch this app.
 */
const PREVIEW_CSP = "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:";

/** Wraps a body in a document with the CSP meta and a neutral base style. */
export function previewDocument(html: string): string {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><base target="_blank"><style>body{margin:0;font-family:system-ui,sans-serif}</style>`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${head}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

export function PreviewFrame({
  html,
  title,
  className,
  height = 520,
}: {
  html: string;
  title: string;
  className?: string;
  height?: number;
}) {
  const [mobile, setMobile] = React.useState(false);
  const doc = React.useMemo(() => previewDocument(html), [html]);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-end gap-1" role="group" aria-label="Preview width">
        <button
          type="button"
          onClick={() => setMobile(false)}
          aria-pressed={!mobile}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", !mobile ? "text-foreground" : "text-muted-foreground")}
        >
          <Monitor className="size-3.5" aria-hidden /> Desktop
        </button>
        <button
          type="button"
          onClick={() => setMobile(true)}
          aria-pressed={mobile}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mobile ? "text-foreground" : "text-muted-foreground")}
        >
          <Smartphone className="size-3.5" aria-hidden /> Mobile
        </button>
      </div>
      <div className="overflow-auto border bg-white" style={{ height }}>
        {/* sandbox="" is deliberate: no scripts, no same-origin access. */}
        <iframe
          title={title}
          sandbox=""
          srcDoc={doc}
          referrerPolicy="no-referrer"
          className={cn("mx-auto block h-full border-0 bg-white", mobile ? "w-[375px] max-w-full" : "w-full")}
        />
      </div>
    </div>
  );
}
