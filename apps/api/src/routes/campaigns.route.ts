import { Router } from "express";
import campaignsService from "../services/campaigns.service";
import templatesService from "../services/templates.service";
import { asyncHandler } from "../utils/asynchandler";
import { created, ctx, ok, str } from "../utils/route";

// ─── /templates ──────────────────────────────────────────────────────────────

export const templatesRouter = Router();
templatesRouter.get("/", asyncHandler(async (req, res) => ok(res, await templatesService.list(ctx(req).tenantId))));
templatesRouter.post("/", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await templatesService.create(tenantId, actorId, req.body ?? {}));
}));
templatesRouter.post("/render", asyncHandler(async (req, res) => ok(res, await templatesService.render(ctx(req).tenantId, req.body ?? {}))));
templatesRouter.post("/:id/duplicate", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await templatesService.duplicate(tenantId, actorId, String(req.params.id)));
}));
templatesRouter.get("/:id", asyncHandler(async (req, res) => ok(res, await templatesService.get(ctx(req).tenantId, String(req.params.id)))));
templatesRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await templatesService.update(tenantId, actorId, String(req.params.id), req.body ?? {}));
}));
templatesRouter.delete("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await templatesService.remove(tenantId, actorId, String(req.params.id)), "Template deleted");
}));

// ─── /campaigns ──────────────────────────────────────────────────────────────

export const campaignsRouter = Router();
const id = (req: { params: Record<string, unknown> }) => String(req.params.id);

campaignsRouter.get("/", asyncHandler(async (req, res) => ok(res, await campaignsService.list(ctx(req).tenantId, { status: str(req.query.status), cursor: str(req.query.cursor), limit: req.query.limit }))));
campaignsRouter.post("/", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await campaignsService.create(tenantId, actorId, req.body ?? {}));
}));
campaignsRouter.get("/:id", asyncHandler(async (req, res) => ok(res, await campaignsService.get(ctx(req).tenantId, id(req)))));
campaignsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await campaignsService.update(tenantId, actorId, id(req), req.body ?? {}));
}));
campaignsRouter.delete("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await campaignsService.remove(tenantId, actorId, id(req)), "Campaign deleted");
}));
campaignsRouter.post("/:id/duplicate", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await campaignsService.duplicate(tenantId, actorId, id(req)));
}));
campaignsRouter.get("/:id/preview", asyncHandler(async (req, res) => ok(res, await campaignsService.preview(ctx(req).tenantId, id(req), str(req.query.contactId)))));
campaignsRouter.get("/:id/preflight", asyncHandler(async (req, res) => ok(res, await campaignsService.preflight(ctx(req).tenantId, id(req)))));
campaignsRouter.post("/:id/test", asyncHandler(async (req, res) => ok(res, await campaignsService.sendTest(ctx(req).tenantId, id(req), req.body?.to))));
campaignsRouter.post("/:id/schedule", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await campaignsService.schedule(tenantId, actorId, id(req), req.body ?? {}));
}));
for (const action of ["unschedule", "pause", "resume", "cancel"] as const) {
  campaignsRouter.post(`/:id/${action}`, asyncHandler(async (req, res) => {
    const { tenantId, actorId } = ctx(req);
    ok(res, await campaignsService[action](tenantId, actorId, id(req)));
  }));
}
campaignsRouter.get("/:id/report", asyncHandler(async (req, res) => ok(res, await campaignsService.report(ctx(req).tenantId, id(req)))));
campaignsRouter.get("/:id/recipients", asyncHandler(async (req, res) => ok(res, await campaignsService.recipients(ctx(req).tenantId, id(req), { status: str(req.query.status), cursor: str(req.query.cursor), limit: req.query.limit }))));
