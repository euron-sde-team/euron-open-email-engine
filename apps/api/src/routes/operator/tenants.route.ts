import { Router } from "express";
import {
  createTenant,
  getTenant,
  listTenants,
  overrideEntitlement,
  updateTenant,
} from "../../controllers/operator/tenants.controller";
import { requireSuperadmin } from "../../middlewares/operator-auth.middleware";
import { validateBody } from "../../middlewares/validate.middleware";
import {
  onboardTenantSchema,
  overrideEntitlementSchema,
  updateTenantSchema,
} from "../../validators/operator/tenants.schema";
import { asyncHandler } from "../../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listTenants));
router.post(
  "/",
  asyncHandler(requireSuperadmin),
  validateBody(onboardTenantSchema),
  asyncHandler(createTenant)
);
router.get("/:id", asyncHandler(getTenant));
router.put(
  "/:id",
  asyncHandler(requireSuperadmin),
  validateBody(updateTenantSchema),
  asyncHandler(updateTenant)
);
router.put(
  "/:id/entitlements",
  asyncHandler(requireSuperadmin),
  validateBody(overrideEntitlementSchema),
  asyncHandler(overrideEntitlement)
);

export default router;
