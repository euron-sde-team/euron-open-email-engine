import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { RuleBuilder } from "@/components/audience/RuleBuilder";
import { Field, Section } from "@/components/common/Section";
import { ContactStatusText } from "@/components/common/status";
import { useDebounced } from "@/components/common/useDebounced";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSegment, getSegment, listCustomFields, listLists, previewSegment, updateSegment } from "@/lib/api/contacts";
import { formatNumber } from "@/lib/format";
import { describeRules, emptyRules, sameRules, serializeRules, type AttrTypeLookup } from "@/lib/segments";
import type { SegmentRules } from "@/types";

export default function SegmentEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const fields = useQuery({ queryKey: ["custom-fields"], queryFn: listCustomFields });
  const existing = useQuery({ queryKey: ["segment", id], queryFn: () => getSegment(id!), enabled: !isNew });

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [rules, setRules] = React.useState<SegmentRules>(emptyRules());
  const [loaded, setLoaded] = React.useState(isNew);

  React.useEffect(() => {
    if (existing.data && !loaded) {
      setName(existing.data.name);
      setDescription(existing.data.description);
      setRules(existing.data.rules);
      setLoaded(true);
    }
  }, [existing.data, loaded]);

  const attrType: AttrTypeLookup = (key) => fields.data?.find((f) => f.key === key)?.type ?? "text";
  const payload = React.useMemo(() => serializeRules(rules, attrType), [rules, fields.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const debounced = useDebounced(payload, 400);
  const dirty = !isNew && existing.data ? !sameRules(rules, existing.data.rules, attrType) || name !== existing.data.name || description !== existing.data.description : true;

  // Live count: the API evaluates the rules and returns a count plus ten sample contacts.
  const preview = useQuery({
    queryKey: ["segment-preview", debounced],
    queryFn: () => previewSegment(debounced),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });

  const save = useMutation({
    mutationFn: () => (isNew ? createSegment({ name: name.trim(), description: description.trim(), rules: payload }) : updateSegment(id!, { name: name.trim(), description: description.trim(), rules: payload })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["segments"] });
      qc.invalidateQueries({ queryKey: ["segment", id] });
      toast.success("Segment saved.");
      navigate("/segments");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isNew && existing.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!isNew && existing.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {(existing.error as Error).message}
      </p>
    );
  }

  const ctx = {
    listName: (lid: string) => (lists.data ?? []).find((l) => l.id === lid)?.name ?? "a deleted list",
    attrLabel: (k: string) => (fields.data ?? []).find((f) => f.key === k)?.label ?? k,
  };

  return (
    <div className="space-y-8">
      <Link to="/segments" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All segments
      </Link>
      <PageHeader
        title={isNew ? "New segment" : name || "Segment"}
        description={describeRules(payload, ctx)}
        actions={
          <Button
            onClick={() => {
              if (!name.trim()) return void toast.error("Give the segment a name.");
              save.mutate();
            }}
            loading={save.isPending}
            disabled={!dirty}
          >
            Save segment
          </Button>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <Field id="seg-name" label="Name">
              <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Engaged this month" />
            </Field>
            <Field id="seg-desc" label="Description (optional)">
              <Input id="seg-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <Section title="Rules">
            <RuleBuilder rules={rules} onChange={setRules} lists={lists.data ?? []} customFields={fields.data ?? []} />
          </Section>
        </div>

        <aside aria-label="Live count" className="lg:sticky lg:top-20 lg:self-start">
          <Section title="Who matches">
            <p className="font-display text-4xl font-semibold tabular-nums tracking-tight" aria-live="polite" aria-atomic="true">
              {preview.data ? formatNumber(preview.data.count) : preview.isError ? "-" : "..."}
              <span className="ml-2 text-sm font-normal text-muted-foreground">{preview.data?.count === 1 ? "contact" : "contacts"}</span>
            </p>
            {preview.isError ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {(preview.error as Error).message}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">Updates as you edit. Unsubscribed, bounced and complained contacts are matched here but never emailed.</p>
            {preview.data && preview.data.sample.length > 0 ? (
              <div className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sample</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.data.sample.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="max-w-44 truncate">{c.email}</TableCell>
                        <TableCell>
                          <ContactStatusText status={c.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </Section>
        </aside>
      </div>
    </div>
  );
}
