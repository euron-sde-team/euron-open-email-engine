import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./client";

/** Public user shape returned by GET /users (password hash stripped). */
export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "DISABLED" | "PENDING";
  /** Module keys this user can access; contains "*" for full access. */
  permissions: string[];
  last_login_at: string | null;
  created_at: string;
}

export interface CustomRole {
  id: string;
  key: string;
  name: string;
  permissions: string[];
}

/** Metadata for one access key (feature module or governance capability). */
export interface ModuleMeta {
  key: string;
  label: string;
  description: string;
  group: string;
  /** True for RBAC-only governance capabilities (channels, team, settings). */
  governance: boolean;
}

/** GET /users/roles: built-in roles, module registry and tenant custom roles. */
export interface RolesCatalogue {
  builtin: string[];
  modules: string[];
  capabilities: string[];
  /** Full metadata for every grantable key, drives the picker and labels. */
  catalogue: ModuleMeta[];
  /** Effective module set per role key. */
  roleModules: Record<string, string[]>;
  customized: string[];
  custom: CustomRole[];
  /** Member count per role key. */
  counts: Record<string, number>;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  role: string;
  /** Optional; when omitted the backend generates a secure password and emails it. */
  password?: string;
  permissions?: string[];
}

export interface CreatedUser extends TeamUser {
  /** True when a sign-in-details email was dispatched. */
  emailed?: boolean;
}

export interface UpdateUserPayload {
  name?: string;
  role?: string;
  status?: TeamUser["status"];
  permissions?: string[];
}

export const listUsers = () => apiGet<TeamUser[]>("/users");
export const getRolesCatalogue = () => apiGet<RolesCatalogue>("/users/roles");
export const createUser = (payload: CreateUserPayload) => apiPost<CreatedUser>("/users", payload);
export const updateUser = (id: string, payload: UpdateUserPayload) => apiPut<TeamUser>(`/users/${id}`, payload);
export const deleteUser = (id: string) => apiDelete<unknown>(`/users/${id}`);
export const resetUserPassword = (id: string) =>
  apiPost<{ ok: true; email: string; emailed: boolean }>(`/users/${id}/reset-password`);

/** Self-service: change the current user's password (verifies the current one). */
export const changeMyPassword = (payload: { currentPassword: string; newPassword: string }) =>
  apiPatch<{ ok: true }>("/users/me/password", payload);

export const createCustomRole = (payload: { name: string; permissions: string[] }) => apiPost<CustomRole>("/users/roles", payload);
export const updateCustomRole = (key: string, payload: { name?: string; permissions?: string[] }) =>
  apiPut<CustomRole>(`/users/roles/${key}`, payload);
export const deleteCustomRole = (key: string) => apiDelete<{ ok: true }>(`/users/roles/${key}`);
