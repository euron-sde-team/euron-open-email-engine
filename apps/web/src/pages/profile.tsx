import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { FactList, Field, Section } from "@/components/common/Section";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeMyPassword } from "@/lib/api/users";
import { useAuthStore } from "@/stores/auth-store";

const prettyRole = (role: string): string =>
  role
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ") || role;

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  const passwordMutation = useMutation({
    mutationFn: () => changeMyPassword({ currentPassword, newPassword }),
    onSuccess: () => {
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error) => toast.error(error.message),
  });

  const submitPassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) return void toast.error("Enter your current and new password.");
    if (newPassword.length < 8) return void toast.error("New password must be at least 8 characters.");
    if (newPassword !== confirmPassword) return void toast.error("New password and confirmation do not match.");
    if (currentPassword === newPassword) return void toast.error("New password must differ from the current password.");
    passwordMutation.mutate();
  };

  if (!user) return null;
  const allModules = user.modules.includes("*");

  return (
    <div className="space-y-8">
      <PageHeader title="My profile" description="Your account details and password." />

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Account" description="Managed by your workspace administrator.">
          <FactList
            items={[
              { label: "Name", value: user.name },
              { label: "Email", value: user.email },
              { label: "Role", value: prettyRole(user.role) },
              { label: "Workspace", value: user.tenant?.name },
              { label: "Plan", value: user.tenant?.plan_key ? prettyRole(user.tenant.plan_key) : null },
              { label: "Access", value: allModules ? "All areas" : `${user.modules.length} areas` },
            ]}
          />
        </Section>

        <Section title="Change password" description="Enter your current password, then choose a new one of at least 8 characters.">
          <form className="max-w-sm space-y-4" onSubmit={submitPassword}>
            <Field id="current-password" label="Current password">
              <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </Field>
            <Field id="new-password" label="New password">
              <Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Field>
            <Field id="confirm-password" label="Confirm new password">
              <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </Field>
            <Button type="submit" loading={passwordMutation.isPending}>
              Update password
            </Button>
          </form>
        </Section>
      </div>
    </div>
  );
}
