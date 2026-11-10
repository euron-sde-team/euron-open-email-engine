import { Request, Response } from "express";
import { UnauthorizedError } from "../../errors";
import tenantsService from "../../services/operator/tenants.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../../utils/response.util";

const actor = (req: Request) => {
  const operator = req.operatorUser;
  if (!operator) throw new UnauthorizedError("Authentication required");
  return { id: operator.id, email: operator.email };
};

export const listTenants = async (req: Request, res: Response) => {
  const result = await tenantsService.list({
    q: req.query.q as string | undefined,
    status: req.query.status as string | undefined,
  });
  sendSuccessResponse({ res, data: result });
};

export const getTenant = async (req: Request, res: Response) => {
  sendSuccessResponse({ res, data: await tenantsService.detail(String(req.params.id)) });
};

export const createTenant = async (req: Request, res: Response) => {
  const result = await tenantsService.onboard(actor(req), req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Tenant onboarded",
  });
};

export const updateTenant = async (req: Request, res: Response) => {
  const updated = await tenantsService.update(actor(req), String(req.params.id), req.body ?? {});
  sendSuccessResponse({ res, data: updated, message: "Tenant updated" });
};

export const overrideEntitlement = async (req: Request, res: Response) => {
  const row = await tenantsService.overrideEntitlement(
    actor(req),
    String(req.params.id),
    req.body ?? {}
  );
  sendSuccessResponse({ res, data: row, message: "Entitlement updated" });
};
