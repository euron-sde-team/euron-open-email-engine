import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Plus } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Field } from "@/components/common/Section";
import { DomainStatusText } from "@/components/common/status";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createDomain, listDomains, listSenders } from "@/lib/api/domains";
import { dnsProgress } from "@/lib/dns";
import { timeAgo } from "@/lib/format";

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function AddDomainDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [domain, setDomain] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setDomain("");
      setError(null);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => createDomain(domain.trim().toLowerCase()),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
      navigate(`/domains/${d.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a sending domain</DialogTitle>
          <DialogDescription>
            Use a subdomain you do not use for anything else, such as <span className="font-mono">mail.yourcompany.example</span>. Your main domain stays untouched.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const v = domain.trim().toLowerCase();
            if (!DOMAIN_RE.test(v)) return void setError("Enter a domain such as mail.yourcompany.example.");
            setError(null);
            create.mutate();
          }}
        >
          <Field id="new-domain" label="Domain" error={error} hint="Lowercase letters, numbers, dots and hyphens.">
            <Input id="new-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="mail.yourcompany.example" autoComplete="off" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? "new-domain-error" : "new-domain-hint"} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Add domain and get DNS records
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function DomainsPage() {
  const [params, setParams] = useSearchParams();
  const domains = useQuery({ queryKey: ["domains"], queryFn: listDomains });
  const senders = useQuery({ queryKey: ["senders"], queryFn: listSenders });
  const open = params.get("new") === "1";
  const setOpen = (o: boolean) => {
    const next = new URLSearchParams(params);
    if (o) next.set("new", "1");
    else next.delete("new");
    setParams(next, { replace: true });
  };

  const list = domains.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sending domains"
        description="Campaigns only go out from a domain you own and have verified with DNS. Verified domains get their own tracking links."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus aria-hidden /> Add domain
          </Button>
        }
      />

      {domains.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : domains.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(domains.error as Error).message}
        </p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No sending domain yet"
          description="Add a subdomain you own. We give you the DKIM, MAIL FROM, SPF, DMARC and tracking records to publish, and tell you when each one is found."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden /> Add your first domain
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>DNS records</TableHead>
              <TableHead>Senders</TableHead>
              <TableHead>Last checked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((d) => {
              const p = dnsProgress(d.records);
              const sc = (senders.data ?? []).filter((s) => s.domainId === d.id && s.status === "ACTIVE").length;
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link to={`/domains/${d.id}`} className="font-medium hover:text-brand hover:underline">
                      {d.domain}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <DomainStatusText status={d.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.requiredFound} of {p.requiredTotal} required found
                  </TableCell>
                  <TableCell className="text-muted-foreground">{sc}</TableCell>
                  <TableCell className="text-muted-foreground">{d.lastCheckedAt ? timeAgo(d.lastCheckedAt) : "never"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <AddDomainDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
