import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { DnsWizard } from "@/components/domains/DnsWizard";
import { Section } from "@/components/common/Section";
import { DomainStatusText } from "@/components/common/status";
import { useConfirm } from "@/components/confirm-provider";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { checkDomain, deleteDomain, getDomain, listSenders } from "@/lib/api/domains";
import { dnsProgress } from "@/lib/dns";
import { formatDateTime, timeAgo } from "@/lib/format";

export default function DomainDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const domain = useQuery({
    queryKey: ["domain", id],
    queryFn: () => getDomain(id),
    // While DNS is still propagating, look again every 20 seconds without a click.
    refetchInterval: (q) => (q.state.data?.status === "PENDING" ? 20_000 : false),
  });
  const senders = useQuery({ queryKey: ["senders"], queryFn: listSenders });

  const check = useMutation({
    mutationFn: () => checkDomain(id),
    onSuccess: (d) => {
      qc.setQueryData(["domain", id], d);
      qc.invalidateQueries({ queryKey: ["domains"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      const p = dnsProgress(d.records);
      if (d.status === "VERIFIED") toast.success("Domain verified. You can create senders now.");
      else toast.message(`${p.requiredFound} of ${p.requiredTotal} required records found. DNS can take a while to spread.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteDomain(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      qc.invalidateQueries({ queryKey: ["senders"] });
      toast.success("Domain removed.");
      navigate("/domains", { replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (domain.isLoading) return <Skeleton className="h-64 w-full" />;
  if (domain.isError || !domain.data) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-danger">
          {(domain.error as Error | null)?.message ?? "Domain not found."}
        </p>
        <Link to="/domains" className="text-sm font-medium text-brand hover:underline">
          Back to domains
        </Link>
      </div>
    );
  }

  const d = domain.data;
  const p = dnsProgress(d.records);
  const mine = (senders.data ?? []).filter((s) => s.domainId === d.id);

  return (
    <div className="space-y-8">
      <Link to="/domains" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All domains
      </Link>
      <PageHeader
        title={d.domain}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <DomainStatusText status={d.status} />
            <span>{d.lastCheckedAt ? `Last checked ${timeAgo(d.lastCheckedAt)}` : "Not checked yet"}</span>
            {d.verifiedAt ? <span>Verified {formatDateTime(d.verifiedAt)}</span> : null}
          </span>
        }
        actions={
          <>
            <Button onClick={() => check.mutate()} loading={check.isPending}>
              <RefreshCw aria-hidden /> Check now
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (await confirm({ title: `Remove ${d.domain}?`, description: "Its senders stop working and campaigns using them cannot be sent.", confirmText: "Remove domain", destructive: true })) remove.mutate();
              }}
            >
              <Trash2 aria-hidden /> Remove
            </Button>
          </>
        }
      />

      {d.status === "VERIFIED" ? (
        <Section title="Ready to send" description="DKIM and MAIL FROM are verified. Create a sender on this domain to start sending campaigns.">
          {mine.length > 0 ? (
            <ul className="divide-y border-y text-sm">
              {mine.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2.5">
                  <span>
                    {s.displayName ? <span className="font-medium">{s.displayName} </span> : null}
                    <span className="text-muted-foreground">&lt;{s.email}&gt;</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{s.status === "ACTIVE" ? "Active" : "Archived"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No senders yet.</p>
          )}
          <div className="mt-3">
            <Button asChild variant="outline" size="sm">
              <Link to={`/senders?new=1&domain=${d.id}`}>Create a sender</Link>
            </Button>
          </div>
        </Section>
      ) : (
        <Section
          title="Publish these DNS records"
          description={
            <>
              Add each record below at the company that hosts DNS for <span className="font-mono">{d.domain}</span>, then press <strong>Check now</strong>. Records usually appear within minutes but can take a few hours. We also re-check on our own every few minutes.
            </>
          }
        >
          <p className="mb-4 text-sm" aria-live="polite">
            <strong className="tabular-nums">
              {p.requiredFound} of {p.requiredTotal}
            </strong>{" "}
            required records found.
            {d.failureReason ? <span className="ml-2 text-danger">{d.failureReason}</span> : null}
          </p>
          <DnsWizard domain={d.domain} records={d.records} />
        </Section>
      )}

      {d.status === "VERIFIED" ? (
        <Section title="DNS records" description="Keep these in place. If a record is removed, sending from this domain stops working.">
          <DnsWizard domain={d.domain} records={d.records} />
        </Section>
      ) : null}
    </div>
  );
}
