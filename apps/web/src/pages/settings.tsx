import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { Field, FactList, Section } from "@/components/common/Section";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboard } from "@/lib/api/dashboard";
import { getTenantMe, updateTenantMe } from "@/lib/api/tenant";
import { contrastRatio, parseHex } from "@/lib/color";
import { formatDate, formatNumber } from "@/lib/format";
import { browserTimezone, listTimezones } from "@/lib/schedule";
import { applyBrandColor, useAuthStore } from "@/stores/auth-store";
import { BRAND } from "@/lib/brand";

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatNumber(used)} of {limit === null ? "unlimited" : formatNumber(limit)}
        </span>
      </div>
      <svg viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label={`${label}: ${limit === null ? "no limit" : `${Math.round(pct)}% used`}`} className="h-1 w-full">
        <rect width="100" height="4" className="fill-muted" />
        <rect width={pct} height="4" className={pct >= 90 ? "fill-danger" : "fill-brand"} />
      </svg>
    </div>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const patchUser = useAuthStore((s) => s.patchUser);
  const tenant = useQuery({ queryKey: ["tenant-me"], queryFn: getTenantMe });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: getDashboard });

  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState<string>(BRAND.defaultColor);
  const [timezone, setTimezone] = React.useState(browserTimezone());
  const [address, setAddress] = React.useState("");

  React.useEffect(() => {
    if (!tenant.data) return;
    setName(tenant.data.name);
    setColor(tenant.data.brand_color || BRAND.defaultColor);
    setTimezone(tenant.data.timezone || browserTimezone());
    setAddress(tenant.data.company_address ?? "");
  }, [tenant.data]);

  const zones = React.useMemo(() => listTimezones().map((z) => ({ value: z, label: z.replace(/_/g, " ") })), []);
  const ratio = contrastRatio(color, "#ffffff");
  const colorValid = parseHex(color) !== null;

  const save = useMutation({
    mutationFn: () => updateTenantMe({ name: name.trim(), brand_color: color, timezone, company_address: address.trim() || null }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["tenant-me"] });
      if (user) patchUser({ tenant: { ...user.tenant, name: t.name, brand_color: t.brand_color } });
      applyBrandColor(t.brand_color);
      toast.success("Settings saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (tenant.isLoading) return <Skeleton className="h-64 w-full" />;
  if (tenant.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {(tenant.error as Error).message}
      </p>
    );
  }

  const u = dash.data?.usage;

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Your workspace name, accent colour, timezone and the address printed in every campaign footer." />

      <form
        className="max-w-2xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return void toast.error("Give the workspace a name.");
          if (!colorValid) return void toast.error("The accent colour must be a six-digit hex such as #ab1757.");
          save.mutate();
        }}
      >
        <Field id="ws-name" label="Workspace name">
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field
          id="ws-color"
          label="Accent colour"
          error={!colorValid ? "Use a six-digit hex such as #ab1757." : null}
          hint={ratio !== null ? `${ratio.toFixed(1)}:1 against white. ${ratio >= 4.5 ? "Readable as text." : "Too light to read as text; the app darkens it automatically."}` : undefined}
        >
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Pick accent colour"
              value={colorValid ? (color.startsWith("#") ? color : `#${color}`) : BRAND.defaultColor}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-md border border-input bg-card p-1"
            />
            <Input id="ws-color" value={color} onChange={(e) => setColor(e.target.value)} className="w-36 font-mono" spellCheck={false} />
          </div>
        </Field>

        <Field id="ws-tz" label="Timezone" hint="Campaign schedules are entered and shown in this zone. They are stored in UTC.">
          <SimpleSelect id="ws-tz" value={timezone} onChange={setTimezone} options={zones} />
        </Field>

        <Field id="ws-address" label="Company postal address" hint="Printed in the footer of every campaign. Anti-spam laws such as CAN-SPAM require a real postal address.">
          <textarea
            id="ws-address"
            rows={3}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="block w-full rounded-md border border-input bg-card p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={"Northwind Mail\n12 Example Street\nSpringfield 00000"}
          />
        </Field>

        <Button type="submit" loading={save.isPending}>
          Save settings
        </Button>
      </form>

      <Section title="Plan and usage" description={user?.tenant?.plan_key ? `You are on the ${user.tenant.plan_key} plan.` : undefined}>
        {u ? (
          <div className="max-w-2xl space-y-4">
            <Usage label="Emails this month" used={u.emails.used} limit={u.emails.limit} />
            <Usage label="Contacts" used={u.contacts.used} limit={u.contacts.limit} />
            <Usage label="Sending domains" used={u.domains.used} limit={u.domains.limit} />
            <p className="text-xs text-muted-foreground">The monthly email count resets on {formatDate(u.resetsAt)} (UTC).</p>
          </div>
        ) : dash.isLoading ? (
          <Skeleton className="h-24 w-full max-w-2xl" />
        ) : (
          <FactList items={[{ label: "Usage", value: "Not available right now." }]} />
        )}
      </Section>
    </div>
  );
}
