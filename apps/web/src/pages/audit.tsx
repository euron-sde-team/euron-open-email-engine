import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounced } from "@/components/common/useDebounced";
import { listAuditLogs } from "@/lib/api/audit";
import { formatDateTime } from "@/lib/format";
import { ScrollText } from "lucide-react";

const ENTITY_TYPES = ["campaign", "contact", "list", "segment", "template", "domain", "sender", "user", "tenant"] as const;

export default function AuditPage() {
  const [actionInput, setActionInput] = React.useState("");
  const action = useDebounced(actionInput.trim(), 400);
  const [entityType, setEntityType] = React.useState("all");

  const logs = useQuery({
    queryKey: ["audit", action, entityType],
    queryFn: () => listAuditLogs({ action: action || undefined, entityType: entityType === "all" ? undefined : entityType }),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" description="Who changed what in this workspace. The last 200 events, newest first." />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="audit-action" className="text-xs font-medium text-muted-foreground">
            Action
          </label>
          <Input id="audit-action" value={actionInput} onChange={(e) => setActionInput(e.target.value)} placeholder="e.g. campaign.send" className="w-56" />
        </div>
        <div className="space-y-1.5">
          <span id="audit-entity-label" className="text-xs font-medium text-muted-foreground">
            Record type
          </span>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger aria-labelledby="audit-entity-label" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {logs.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : logs.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(logs.error as Error).message}
        </p>
      ) : (logs.data ?? []).length === 0 ? (
        <EmptyState icon={ScrollText} title="No events match" description="Try a different action or record type." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(logs.data ?? []).map((log) => (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(log.created_at)}</TableCell>
                <TableCell>{log.user}</TableCell>
                <TableCell className="font-mono text-xs">{log.action}</TableCell>
                <TableCell className="text-muted-foreground">
                  {log.entity_type ?? "-"}
                  {log.entity_id ? <span className="ml-1 font-mono text-xs">{log.entity_id.slice(-6)}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
