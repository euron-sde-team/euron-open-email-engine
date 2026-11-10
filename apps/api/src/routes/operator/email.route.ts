import { Router } from "express";
import { UnauthorizedError } from "../../errors";
import { requireSuperadmin } from "../../middlewares/operator-auth.middleware";
import emailFleetService from "../../services/operator/email-fleet.service";
import { asyncHandler } from "../../utils/asynchandler";
import { sendSuccessResponse } from "../../utils/response.util";

// Mounted at /api/v1/operator/email: fleet-level email views for the console.
const router = Router();

router.get("/fleet", asyncHandler(async (_req, res) => sendSuccessResponse({ res, data: await emailFleetService.fleet() })));
router.get("/account-health", asyncHandler(async (_req, res) => sendSuccessResponse({ res, data: await emailFleetService.accountHealth() })));
router.get("/dlq", asyncHandler(async (_req, res) => sendSuccessResponse({ res, data: await emailFleetService.dlq() })));

export default router;

// Mounted on the tenants router: /tenants/:id/email and /tenants/:id/email/unpause.
export const tenantEmailRouter = Router({ mergeParams: true });
tenantEmailRouter.get("/:id/email", asyncHandler(async (req, res) => sendSuccessResponse({ res, data: await emailFleetService.tenantEmail(String(req.params.id)) })));
tenantEmailRouter.post(
  "/:id/email/unpause",
  asyncHandler(requireSuperadmin),
  asyncHandler(async (req, res) => {
    const op = req.operatorUser;
    if (!op) throw new UnauthorizedError("Authentication required");
    sendSuccessResponse({ res, data: await emailFleetService.unpause({ id: op.id, email: op.email }, String(req.params.id), req.body?.reason), message: "Sending resumed" });
  })
);
