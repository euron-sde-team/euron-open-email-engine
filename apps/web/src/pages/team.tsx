import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Trash2, UserCog } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Field, Section } from "@/components/common/Section";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { useConfirm } from "@/components/confirm-provider";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createCustomRole,
  createUser,
  deleteCustomRole,
  deleteUser,
  getRolesCatalogue,
  listUsers,
  resetUserPassword,
  updateCustomRole,
  updateUser,
  type CustomRole,
  type RolesCatalogue,
  type TeamUser,
} from "@/lib/api/users";
import { formatDate, timeAgo } from "@/lib/format";
import { useAuthStore } from "@/stores/auth-store";

const roleLabel = (key: string, cat?: RolesCatalogue): string =>
  cat?.custom.find((r) => r.key === key)?.name ?? key.split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");

function MemberDialog({
  open,
  onOpenChange,
  member,
  catalogue,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  member: TeamUser | null;
  catalogue?: RolesCatalogue;
}) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("");
  const [status, setStatus] = React.useState<TeamUser["status"]>("ACTIVE");

  const roles = React.useMemo(
    () => [...(catalogue?.builtin ?? []), ...(catalogue?.custom.map((r) => r.key) ?? [])].map((k) => ({ value: k, label: roleLabel(k, catalogue) })),
    [catalogue],
  );

  React.useEffect(() => {
    if (!open) return;
    setName(member?.name ?? "");
    setEmail(member?.email ?? "");
    setRole(member?.role ?? roles[0]?.value ?? "");
    setStatus(member?.status ?? "ACTIVE");
  }, [open, member, roles]);

  const save = useMutation({
    mutationFn: () =>
      member
        ? updateUser(member.id, { name: name.trim(), role, status })
        : createUser({ name: name.trim(), email: email.trim(), role }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["team"] });
      qc.invalidateQueries({ queryKey: ["roles"] });
      const emailed = (res as { emailed?: boolean }).emailed;
      toast.success(member ? "Member updated." : emailed ? "Member added. Sign-in details are on their way." : "Member added.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{member ? "Edit member" : "Add a team member"}</DialogTitle>
          <DialogDescription>{member ? "Change their name, role or access." : "They get an email with a temporary password."}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || (!member && !email.trim()) || !role) return void toast.error("Fill in name, email and role.");
            save.mutate();
          }}
        >
          <Field id="member-name" label="Name">
            <Input id="member-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field id="member-email" label="Email" hint={member ? "An email address cannot be changed." : undefined}>
            <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={Boolean(member)} autoComplete="off" />
          </Field>
          <Field id="member-role" label="Role">
            <SimpleSelect id="member-role" value={role} onChange={setRole} options={roles} />
          </Field>
          {member ? (
            <Field id="member-status" label="Status">
              <SimpleSelect
                id="member-status"
                value={status}
                onChange={(v) => setStatus(v as TeamUser["status"])}
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "DISABLED", label: "Disabled (cannot sign in)" },
                ]}
              />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {member ? "Save" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({
  open,
  onOpenChange,
  role,
  catalogue,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role: CustomRole | null;
  catalogue?: RolesCatalogue;
}) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [perms, setPerms] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!open) return;
    setName(role?.name ?? "");
    setPerms(role?.permissions ?? []);
  }, [open, role]);
  const save = useMutation({
    mutationFn: () => (role ? updateCustomRole(role.key, { name: name.trim(), permissions: perms }) : createCustomRole({ name: name.trim(), permissions: perms })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      toast.success("Role saved.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (key: string) => setPerms((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  const groups = React.useMemo(() => {
    const map = new Map<string, NonNullable<typeof catalogue>["catalogue"]>();
    for (const m of catalogue?.catalogue ?? []) map.set(m.group, [...(map.get(m.group) ?? []), m]);
    return [...map.entries()];
  }, [catalogue]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? "Edit role" : "New role"}</DialogTitle>
          <DialogDescription>Pick the areas this role can open.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return void toast.error("Give the role a name.");
            save.mutate();
          }}
        >
          <Field id="role-name" label="Role name">
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {groups.map(([group, items]) => (
            <fieldset key={group} className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</legend>
              {items.map((m) => (
                <div key={m.key} className="flex items-start gap-2.5 text-sm">
                  <input id={`perm-${m.key}`} type="checkbox" checked={perms.includes(m.key)} onChange={() => toggle(m.key)} className="mt-1 size-4 accent-[rgb(var(--brand))]" />
                  <label htmlFor={`perm-${m.key}`} className="cursor-pointer">
                    <span className="font-medium">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.description}</span>
                  </label>
                </div>
              ))}
            </fieldset>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const me = useAuthStore((s) => s.user);
  const users = useQuery({ queryKey: ["team"], queryFn: listUsers });
  const roles = useQuery({ queryKey: ["roles"], queryFn: getRolesCatalogue });
  const [memberDialog, setMemberDialog] = React.useState<{ open: boolean; member: TeamUser | null }>({ open: false, member: null });
  const [roleDialog, setRoleDialog] = React.useState<{ open: boolean; role: CustomRole | null }>({ open: false, role: null });

  const remove = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
      toast.success("Member removed.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: (id: string) => resetUserPassword(id),
    onSuccess: (r) => toast.success(r.emailed ? `A new password was emailed to ${r.email}.` : "Password reset."),
    onError: (e: Error) => toast.error(e.message),
  });
  const removeRole = useMutation({
    mutationFn: (key: string) => deleteCustomRole(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      toast.success("Role deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moduleLabel = (k: string) => roles.data?.catalogue.find((m) => m.key === k)?.label ?? k;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Team"
        description="Who can sign in to this workspace and what they can open."
        actions={
          <Button onClick={() => setMemberDialog({ open: true, member: null })}>
            <Plus aria-hidden /> Add member
          </Button>
        }
      />

      {users.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : users.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(users.error as Error).message}
        </p>
      ) : (users.data ?? []).length === 0 ? (
        <EmptyState icon={UserCog} title="No team members yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users.data ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>{roleLabel(u.role, roles.data)}</TableCell>
                <TableCell>
                  <Badge variant={u.status === "ACTIVE" ? "success" : "neutral"}>{u.status === "ACTIVE" ? "Active" : u.status === "PENDING" ? "Invited" : "Disabled"}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.last_login_at ? timeAgo(u.last_login_at) : `Added ${formatDate(u.created_at)}`}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${u.name}`} onClick={() => setMemberDialog({ open: true, member: u })}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Reset password for ${u.name}`}
                      onClick={async () => {
                        if (await confirm({ title: `Reset ${u.name}'s password?`, description: "A new random password is generated and emailed to them.", confirmText: "Reset password" })) reset.mutate(u.id);
                      }}
                    >
                      <KeyRound />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${u.name}`}
                      disabled={u.id === me?.id}
                      onClick={async () => {
                        if (await confirm({ title: `Remove ${u.name}?`, description: "They lose access immediately.", confirmText: "Remove", destructive: true })) remove.mutate(u.id);
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

      <Section
        title="Roles"
        description="Built-in roles cannot be edited. Create your own for anything in between."
        actions={
          <Button variant="outline" size="sm" onClick={() => setRoleDialog({ open: true, role: null })}>
            <Plus aria-hidden /> New role
          </Button>
        }
      >
        <ul className="divide-y border-y">
          {[...(roles.data?.builtin ?? []).map((k) => ({ key: k, name: roleLabel(k), custom: null as CustomRole | null })), ...(roles.data?.custom ?? []).map((r) => ({ key: r.key, name: r.name, custom: r }))].map((r) => {
            const mods = roles.data?.roleModules?.[r.key] ?? r.custom?.permissions ?? [];
            return (
              <li key={r.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {r.name} <span className="font-normal text-muted-foreground">({roles.data?.counts?.[r.key] ?? 0} members)</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{mods.includes("*") ? "Everything" : mods.map(moduleLabel).join(", ") || "No access"}</p>
                </div>
                {r.custom ? (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setRoleDialog({ open: true, role: r.custom })}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (await confirm({ title: `Delete the ${r.name} role?`, description: "This is blocked while anyone still holds it.", confirmText: "Delete", destructive: true })) removeRole.mutate(r.key);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Section>

      <MemberDialog open={memberDialog.open} onOpenChange={(o) => setMemberDialog((s) => ({ ...s, open: o }))} member={memberDialog.member} catalogue={roles.data} />
      <RoleDialog open={roleDialog.open} onOpenChange={(o) => setRoleDialog((s) => ({ ...s, open: o }))} role={roleDialog.role} catalogue={roles.data} />
    </div>
  );
}
