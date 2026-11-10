import { Router } from "express";
import { authenticateOperator } from "../../middlewares/operator-auth.middleware";
import { asyncHandler } from "../../utils/asynchandler";

import auditRouter from "./audit.route";
import authRouter from "./auth.route";
import emailRouter, { tenantEmailRouter } from "./email.route";
import metricsRouter from "./metrics.route";
import operatorsRouter from "./operators.route";
import plansRouter from "./plans.route";
import tenantsRouter from "./tenants.route";

const rootRouter = Router();

// ---- Public ----
rootRouter.use("/auth", authRouter);

// ---- Authenticated operator console ----
const A = (path: string, router: Router) => {
  rootRouter.use(path, asyncHandler(authenticateOperator), router);
};
A("/operators", operatorsRouter);
A("/plans", plansRouter);
A("/tenants", tenantEmailRouter);
A("/tenants", tenantsRouter);
A("/email", emailRouter);
A("/metrics", metricsRouter);
A("/audit", auditRouter);

export default rootRouter;
