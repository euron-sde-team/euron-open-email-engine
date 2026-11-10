import { Router } from "express";
import emailIdentitiesService from "../services/email-identities.service";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";
import { created, ctx, ok } from "../utils/route";

// Mounted at /email/senders. Sending setup is the `channels` capability.
const router = Router();

router.get("/", asyncHandler(async (req, res) => ok(res, await emailIdentitiesService.list(ctx(req).tenantId))));
router.post(
  "/",
  asyncHandler(requireCapability("channels")),
  asyncHandler(async (req, res) => {
    const { tenantId, actorId } = ctx(req);
    created(res, await emailIdentitiesService.create(tenantId, actorId, req.body ?? {}), "Sender added");
  })
);
router.patch(
  "/:id",
  asyncHandler(requireCapability("channels")),
  asyncHandler(async (req, res) => {
    const { tenantId, actorId } = ctx(req);
    ok(res, await emailIdentitiesService.update(tenantId, actorId, String(req.params.id), req.body ?? {}));
  })
);
router.delete(
  "/:id",
  asyncHandler(requireCapability("channels")),
  asyncHandler(async (req, res) => {
    const { tenantId, actorId } = ctx(req);
    ok(res, await emailIdentitiesService.remove(tenantId, actorId, String(req.params.id)), "Sender removed");
  })
);
router.post(
  "/:id/test",
  asyncHandler(requireCapability("channels")),
  asyncHandler(async (req, res) => {
    const { tenantId, user } = ctx(req);
    ok(res, await emailIdentitiesService.sendTest(tenantId, String(req.params.id), user.email));
  })
);

export default router;
