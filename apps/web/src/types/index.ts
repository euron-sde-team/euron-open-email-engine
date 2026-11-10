// Shared types for the Open Mail tenant app. The email-engine resource shapes live
// in @open-email/types (the API contract); this file holds the shell types the base
// already had: the response envelope, the signed-in user and the workspace.

export type * from "@open-email/types";

// ---- API envelope ----

export interface ApiErrorEnvelope {
  error: { message: string };
  statusCode: number;
  message: string;
  success: false;
}

// ---- Auth ----

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  brand_color: string;
  plan_key: string | null;
}

export type UserRole = "ADMIN" | "MANAGER" | (string & {});

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenant_id: string;
  /** Module keys this user can access; contains "*" for every module. */
  modules: string[];
  tenant: Tenant;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// ---- Notifications ----

export interface NotificationItem {
  id: string;
  tenant_id: string;
  user_id: string;
  text: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  unread: number;
  notifications: NotificationItem[];
}
