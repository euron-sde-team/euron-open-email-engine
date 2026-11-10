import { useQuery } from "@tanstack/react-query";
import type { EmailEventType } from "@open-email/types";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { FactList, Section } from "@/components/common/Section";
import { MessageStatusText } from "@/components/common/status";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { getMessage } from "@/lib/api/monitoring";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const EVENT_TEXT: Record<EmailEventType, string> = {
  SEND: "Handed to the mail provider",
  DELIVERY: "Delivered to the recipient's mail server",
  BOUNCE: "Bounced",
  COMPLAINT: "Recipient marked it as spam",
  REJECT: "Rejected before sending",
  OPEN: "Opened",
  CLICK: "Clicked a link",
  UNSUBSCRIBE: "Unsubscribed",
};
const TONE: Partial<Record<EmailEventType, string>> = { DELIVERY: "bg-success", BOUNCE: "bg-danger", COMPLAINT: "bg-danger", REJECT: "bg-danger", OPEN: "bg-brand", CLICK: "bg-success", UNSUBSCRIBE: "bg-warning" };

export default function MessageDetailPage() {
  const { id = "" } = useParams();
  const msg = useQuery({ queryKey: ["message", id], queryFn: () => getMessage(id) });
  if (msg.isLoading) return <Skeleton className="h-64 w-full" />;
  if (msg.isError || !msg.data) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-danger">
          {(msg.error as Error | null)?.message ?? "Message not found."}
        </p>
        <Link to="/messages" className="text-sm font-medium text-brand hover:underline">
          Back to messages
        </Link>
      </div>
    );
  }
  const m = msg.data;
  return (
    <div className="space-y-8">
      <Link to="/messages" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All messages
      </Link>
      <PageHeader title={m.subject || "(no subject)"} description={<MessageStatusText status={m.status} />} />
      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Details">
          <FactList
            items={[
              { label: "To", value: m.to },
              { label: "From", value: m.from },
              { label: "Type", value: m.category.charAt(0) + m.category.slice(1).toLowerCase() },
              { label: "Campaign", value: m.campaignId ? <Link className="text-brand hover:underline" to={`/campaigns/${m.campaignId}`}>{m.campaignName}</Link> : null },
              { label: "Created", value: formatDateTime(m.createdAt) },
              { label: "Delivered", value: m.deliveredAt ? formatDateTime(m.deliveredAt) : null },
              { label: "Bounce type", value: m.bounceType },
              { label: "Opens and clicks", value: `${m.opens} and ${m.clicks}` },
              { label: "Provider id", value: m.sesMessageId ? <span className="font-mono text-xs">{m.sesMessageId}</span> : null },
              { label: "Mode", value: m.simulated ? "Simulated (no real email left this server)" : "Sent through Amazon SES" },
            ]}
          />
        </Section>
        <Section title="Timeline">
          {m.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <ol className="divide-y border-y">
              {m.events.map((e) => (
                <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm">
                  <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONE[e.type] ?? "bg-muted-foreground")} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {EVENT_TEXT[e.type] ?? e.type}
                      {e.machine ? <span className="font-normal text-muted-foreground"> (likely a mail client, not a person)</span> : null}
                    </p>
                    {e.url ? <p className="truncate text-xs text-muted-foreground">{e.url}</p> : e.detail ? <p className="text-xs text-muted-foreground">{e.detail}</p> : null}
                  </div>
                  <time dateTime={e.at} className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(e.at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  );
}
