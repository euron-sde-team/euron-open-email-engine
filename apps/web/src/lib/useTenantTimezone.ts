import { useQuery } from "@tanstack/react-query";

import { getTenantMe } from "@/lib/api/tenant";
import { browserTimezone, isValidTimezone } from "@/lib/schedule";

/** The workspace timezone from Settings, falling back to the browser's. */
export function useTenantTimezone(): string {
  const { data } = useQuery({ queryKey: ["tenant-me"], queryFn: getTenantMe, staleTime: 5 * 60_000 });
  const tz = data?.timezone;
  return tz && isValidTimezone(tz) ? tz : browserTimezone();
}
