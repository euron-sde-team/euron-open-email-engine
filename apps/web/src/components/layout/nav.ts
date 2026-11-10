import {
  ScrollText,
  FileText,
  Globe,
  LayoutDashboard,
  ListChecks,
  Mail,
  Megaphone,
  Inbox,
  Filter,
  Settings,
  ShieldCheck,
  ShieldOff,
  Upload,
  UserCog,
  Users,
  Activity,
  type LucideIcon,
} from "lucide-react";

import { hasModule } from "@/stores/auth-store";
import type { User } from "@/types";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Module key gating this item; hidden when the user lacks it. */
  module?: string;
  /** Roles allowed to see this item; hidden for everyone else. */
  roles?: string[];
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/**
 * Single source of truth for the left rail and the command palette navigation
 * entries. Items with a module key are hidden when the signed-in user is not
 * entitled; items with roles are hidden for other roles. routes.tsx gates the
 * same keys at the route so typing a URL does not get around it.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    group: "Overview",
    items: [{ label: "Dashboard", path: "/dashboard", icon: LayoutDashboard }],
  },
  {
    group: "Audience",
    items: [
      { label: "Contacts", path: "/contacts", icon: Users, module: "audience" },
      { label: "Lists", path: "/lists", icon: ListChecks, module: "audience" },
      { label: "Segments", path: "/segments", icon: Filter, module: "audience" },
      { label: "Forms", path: "/forms", icon: FileText, module: "audience" },
      { label: "Import", path: "/import", icon: Upload, module: "audience" },
    ],
  },
  {
    group: "Email",
    items: [
      { label: "Campaigns", path: "/campaigns", icon: Megaphone, module: "campaigns" },
      { label: "Templates", path: "/templates", icon: Mail, module: "templates" },
    ],
  },
  {
    group: "Sending",
    items: [
      { label: "Domains", path: "/domains", icon: Globe, module: "channels" },
      { label: "Senders", path: "/senders", icon: ShieldCheck, module: "channels" },
    ],
  },
  {
    group: "Monitoring",
    items: [
      { label: "Messages", path: "/messages", icon: Inbox, module: "email" },
      { label: "Suppressions", path: "/suppressions", icon: ShieldOff, module: "email" },
      { label: "Reputation", path: "/reputation", icon: Activity, module: "email" },
    ],
  },
  {
    group: "Administration",
    items: [
      { label: "Team", path: "/team", icon: UserCog, module: "team" },
      { label: "Audit log", path: "/audit", icon: ScrollText, module: "audit" },
      { label: "Settings", path: "/settings", icon: Settings, module: "settings" },
    ],
  },
];

/** True when the user may see this nav item (role gate, then module gate). */
export const canSee = (user: User | null | undefined, item: NavItem): boolean => {
  if (!user) return false;
  if (item.roles && !item.roles.includes(user.role)) return false;
  if (item.module && !hasModule(user, item.module)) return false;
  return true;
};

/** Nav groups filtered for one user; empty groups are dropped. */
export const visibleNavGroups = (user: User | null | undefined): NavGroup[] =>
  NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSee(user, item)),
  })).filter((group) => group.items.length > 0);
