import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EmailTemplate } from "@open-email/types";
import { Copy, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-provider";
import { Section } from "@/components/common/Section";
import { previewDocument } from "@/components/email/PreviewFrame";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteTemplate, duplicateTemplate, listTemplates } from "@/lib/api/templates";
import { formatDate } from "@/lib/format";

/** A small, inert preview: a scaled, sandboxed iframe that cannot be focused or clicked. */
function Thumb({ t }: { t: EmailTemplate }) {
  return (
    <div className="relative h-52 w-full overflow-hidden border bg-white" aria-hidden>
      <iframe
        title={`Preview of ${t.name}`}
        tabIndex={-1}
        sandbox=""
        srcDoc={previewDocument(t.html)}
        loading="lazy"
        className="pointer-events-none absolute left-0 top-0 h-[800px] w-[640px] origin-top-left border-0"
        style={{ transform: "scale(0.4)" }}
      />
    </div>
  );
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const templates = useQuery({ queryKey: ["templates"], queryFn: listTemplates });
  const mine = (templates.data ?? []).filter((t) => !t.isStarter);
  const starters = (templates.data ?? []).filter((t) => t.isStarter);

  const dup = useMutation({
    mutationFn: (id: string) => duplicateTemplate(id),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      navigate(`/templates/${t.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Templates"
        description="Reusable email designs with merge tags. Start from a starter or paste your own HTML."
        actions={
          <Button asChild>
            <Link to="/templates/new">
              <Plus aria-hidden /> New template
            </Link>
          </Button>
        }
      />

      {templates.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : templates.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(templates.error as Error).message}
        </p>
      ) : (
        <>
          <Section title="Your templates">
            {mine.length === 0 ? (
              <EmptyState icon={Mail} title="No templates of your own yet" description="Pick a starter below and make it yours, or write one from scratch." className="py-10" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mine.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link to={`/templates/${t.id}`} className="font-medium hover:text-brand hover:underline">
                          {t.name}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">{t.subject}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.updatedAt)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button asChild variant="ghost" size="icon" aria-label={`Edit ${t.name}`}>
                            <Link to={`/templates/${t.id}`}>
                              <Pencil />
                            </Link>
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={`Duplicate ${t.name}`} onClick={() => dup.mutate(t.id)}>
                            <Copy />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${t.name}`}
                            onClick={async () => {
                              if (await confirm({ title: `Delete ${t.name}?`, description: "Campaigns already built from it keep their own copy of the content.", confirmText: "Delete", destructive: true })) del.mutate(t.id);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <Section title="Starter gallery" description="Eight ready-made layouts. Using one makes a copy you can edit.">
            <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
              {starters.map((t) => (
                <li key={t.id} className="space-y-2">
                  <Thumb t={t} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{t.name}</h3>
                      <p className="truncate text-xs text-muted-foreground">{t.subject}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => dup.mutate(t.id)} loading={dup.isPending && dup.variables === t.id}>
                      Use<span className="sr-only"> {t.name}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
