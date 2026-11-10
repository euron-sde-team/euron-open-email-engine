import type { operator_role, tenant_status, user_status } from "../db/enums";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        tenantId: string;
        name: string;
        email: string;
        role: string;
        permissions: string[] | null;
        status: user_status;
      };
      tenantId?: string;
      tenant?: {
        id: string;
        slug: string;
        name: string;
        status: tenant_status;
        brandColor: string;
        config: Record<string, unknown> | null;
      };
      // Operator console (platform tier) auth context. Populated only by the
      // operator auth middleware on /api/v1/operator routes; independent of the
      // tenant authUser above.
      operatorUser?: {
        id: string;
        email: string;
        name: string;
        role: operator_role;
      };
    }
  }
}

export {};
