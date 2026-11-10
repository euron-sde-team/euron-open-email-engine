import type { MessageCategory, MessageRow, MessageStatus } from "@open-email/types";
import { Inbox } from "lucide-react";
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";

import { LoadMore } from "@/components/common/LoadMore";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { MessageStatusText } from "@/components/common/status";
import { useCursorList } from "@/components/common/useAccumulated";
import { useDebounced } from "@/components/common/useDebounced";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listMessages } from "@/lib/api/monitoring";
import { formatDateTime } from "@/lib/format";

const STATUSES: MessageStatus[] = ["QUEUED", "SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "REJECTED", "FAILED", "SUPPRESSED"];
const CATEGORIES: MessageCategory[] = ["MARKETING", "TRANSACTIONAL", "NOTIFICATION"];
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default function MessagesPage() {
  const [params] = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [category, setCategory] = React.useState("all");
  const dq = useDebounced(q.trim(), 300);
  const filters = { q: dq, status: status === "all" ? "" : (status as MessageStatus), category: category === "all" ? "" : (category as MessageCategory), campaignId };
  const list = useCursorList<MessageRow>(["messages", filters], (cursor) => listMessages({ ...filters, cursor }));

  return (
    <div className="space-y-6">
      <PageHeader title="Messages" description="Every email the engine handled, with its delivery result. Open one to see its full timeline." />
      <form role="search" aria-label="Filter messages" className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-1.5">
          <label htmlFor="m-q" className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <Input id="m-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Recipient or subject" className="w-64" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="m-status" className="text-xs font-medium text-muted-foreground">
            Status
          </label>
          <SimpleSelect id="m-status" className="w-44" value={status} onChange={setStatus} options={[{ value: "all", label: "Any status" }, ...STATUSES.map((s) => ({ value: s, label: cap(s) }))]} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="m-cat" className="text-xs font-medium text-muted-foreground">
            Type
          </label>
          <SimpleSelect id="m-cat" className="w-44" value={category} onChange={setCategory} options={[{ value: "all", label: "Any type" }, ...CATEGORIES.map((s) => ({ value: s, label: cap(s) }))]} />
        </div>
        {campaignId ? (
          <p className="pb-2 text-sm text-muted-foreground">
            One campaign only.{" "}
            <Link to="/messages" className="font-medium text-brand hover:underline">
              Show all
            </Link>
          </p>
        ) : null}
      </form>

      {list.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger">
          {list.error?.message}
        </p>
      ) : list.items.length === 0 ? (
        <EmptyState icon={Inbox} title="No messages" description="Messages appear here as soon as a campaign or a test email is sent." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <Link to={`/messages/${m.id}`} className="font-medium hover:text-brand hover:underline">
                      {m.to}
                    </Link>
                    {m.simulated ? <div className="text-xs text-muted-foreground">simulated</div> : null}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">{m.subject}</TableCell>
                  <TableCell>
                    <MessageStatusText status={m.status} />
                    {m.bounceType ? <div className="text-xs text-muted-foreground">{m.bounceType}</div> : null}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground">{m.campaignName ?? cap(m.category)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.opens}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.clicks}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.fetchMore} shown={list.items.length} total={list.total} />
        </>
      )}
    </div>
  );
}
