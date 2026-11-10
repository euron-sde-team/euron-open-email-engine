import type { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import { HttpSuccessStatus, sendSuccessResponse } from "./response.util";

/** The signed-in tenant user. Every tenant route reads its tenant from here, never from input. */
export const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id, role: user.role, user };
};

export const ok = <T>(res: Response, data: T, message?: string): void =>
  sendSuccessResponse({ res, data, message });

export const created = <T>(res: Response, data: T, message?: string): void =>
  sendSuccessResponse({ res, data, statusCode: HttpSuccessStatus.CREATED, message });

export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Cursor page in the wire shape (`Paged<T>`). */
export const paged = <T>(rows: T[], limit: number, cursorOf: (row: T) => string, total?: number) => {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? cursorOf(items[items.length - 1]) : null,
    ...(total !== undefined ? { total } : {}),
  };
};
