import { Router } from "express";
import dashboardService from "../services/dashboard.service";
import emailLogService from "../services/email-log.service";
import { asyncHandler } from "../utils/asynchandler";
import { created, ctx, ok, str } from "../utils/route";

// Mounted at /email (module `email`): message log, reputation, suppressions.
export const emailLogRouter = Router();

emailLogRouter.get("/messages", asyncHandler(async (req, res) =>
  ok(res, await emailLogService.messages(ctx(req).tenantId, { status: str(req.query.status), category: str(req.query.category), campaignId: str(req.query.campaignId), q: str(req.query.q), cursor: str(req.query.cursor), limit: req.query.limit }))));
emailLogRouter.get("/messages/:id", asyncHandler(async (req, res) => ok(res, await emailLogService.message(ctx(req).tenantId, String(req.params.id)))));
emailLogRouter.get("/reputation", asyncHandler(async (req, res) => ok(res, await emailLogService.reputation(ctx(req).tenantId))));
emailLogRouter.get("/suppressions", asyncHandler(async (req, res) =>
  ok(res, await emailLogService.suppressions(ctx(req).tenantId, { q: str(req.query.q), reason: str(req.query.reason), cursor: str(req.query.cursor), limit: req.query.limit }))));
emailLogRouter.post("/suppressions", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await emailLogService.addSuppression(tenantId, actorId, req.body ?? {}));
}));
emailLogRouter.delete("/suppressions/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await emailLogService.removeSuppression(tenantId, actorId, String(req.params.id)));
}));

// GET /dashboard (module `analytics`).
export const dashboardRouter = Router();
dashboardRouter.get("/", asyncHandler(async (req, res) => ok(res, await dashboardService.get(ctx(req).tenantId))));
