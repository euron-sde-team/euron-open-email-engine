import { useQuery } from "@tanstack/react-query";

import { useDebounced } from "@/components/common/useDebounced";
import { renderTemplate } from "@/lib/api/templates";

/**
 * Renders subject and body through the API (so merge tags, defaults and link rewriting behave
 * exactly as they will at send time) a moment after the author stops typing.
 */
export function useRenderedPreview(input: { subject: string; preheader?: string; html: string; contactId?: string }) {
  const debounced = useDebounced(input, 500);
  return useQuery({
    queryKey: ["render", debounced],
    queryFn: () => renderTemplate(debounced),
    enabled: debounced.html.trim().length > 0,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: 0,
  });
}
