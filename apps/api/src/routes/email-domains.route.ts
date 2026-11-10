import { Router } from "express";
import emailDomainsService from "../services/email-domains.service";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";
import { created, ctx, ok } from "../utils/route";

// Mounted at /email/domains. Sending setup is the `channels` capability.
const router = Router();

router.get("/", asyncHandler(async (req, res) => ok(res, await emailDomainsService.list(ctx(req).tenantId))));
router.post(
  "/",
  asyncHandler(requireCapability("channels")),
  asyncHandler(async (req, res) => {
    const { tenantId, actorId } = ctx(req);
    created(res, await emailDomainsService.onboard(tenantId, actorId, req.body ?? {}), "Domain added");
  })
);
// Static sub-routes before the /:id param route.
router.post(
  "/:id/check",
  asyncHandler(requireCapability("channels")),
  asyncHandler(async (req, res) => ok(res, await emailDomainsService.check(ctx(req).tenantId, String(req.params.id))))
);
router.get("/:id", asyncHandler(async (req, res) => ok(res, await emailDomainsService.get(ctx(req).tenantId, String(req.params.id)))));
router.delete(
  "/:id",
  asyncHandler(requireCapability("channels")),
  asyncHandler(async (req, res) => {
    const { tenantId, actorId } = ctx(req);
    ok(res, await emailDomainsService.remove(tenantId, actorId, String(req.params.id)), "Domain removed");
  })
);

export default router;
