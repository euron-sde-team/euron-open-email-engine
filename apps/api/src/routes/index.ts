import { Router } from "express";
import { ModuleKey } from "../constants/modules.const";
import { authenticateUser } from "../middlewares/auth.middleware";
import { requireAnyAccess, requireModule } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

import auditRouter from "./audit.route";
import { contactsRouter, customFieldsRouter, formsRouter, importsRouter, listsRouter, segmentsRouter } from "./audience.route";
import authRouter from "./auth.route";
import { campaignsRouter, templatesRouter } from "./campaigns.route";
import emailDomainsRouter from "./email-domains.route";
import emailIdentitiesRouter from "./email-identities.route";
import { dashboardRouter, emailLogRouter } from "./email-log.route";
import notificationsRouter from "./notifications.route";
import tenantsRouter from "./tenants.route";
import usersRouter from "./users.route";

const rootRouter = Router();

// ---- Public ----
rootRouter.use("/auth", authRouter);

// ---- Authenticated, not module-gated (workspace basics) ----
const A = (path: string, router: Router) => {
  rootRouter.use(path, asyncHandler(authenticateUser), router);
};
A("/tenant", tenantsRouter);
A("/users", usersRouter);
A("/notifications", notificationsRouter);

// ---- Module-gated (entitlement + RBAC), one reviewable map ----
const M = (path: string, moduleKey: ModuleKey, router: Router) => {
  rootRouter.use(path, asyncHandler(authenticateUser), asyncHandler(requireModule(moduleKey)), router);
};

// Sending setup: the `channels` capability writes; reading the sender list is also open to
// anyone who can compose campaigns. Mounted before the generic /email router below.
const G = (path: string, router: Router) => {
  rootRouter.use(path, asyncHandler(authenticateUser), asyncHandler(requireAnyAccess("channels", "campaigns", "email")), router);
};
G("/email/domains", emailDomainsRouter);
G("/email/senders", emailIdentitiesRouter);

M("/dashboard", "analytics", dashboardRouter);
M("/contacts", "audience", contactsRouter);
M("/custom-fields", "audience", customFieldsRouter);
M("/lists", "audience", listsRouter);
M("/segments", "audience", segmentsRouter);
M("/forms", "audience", formsRouter);
M("/imports", "audience", importsRouter);
M("/templates", "templates", templatesRouter);
M("/campaigns", "campaigns", campaignsRouter);
M("/email", "email", emailLogRouter);
M("/audit", "audit", auditRouter);

export default rootRouter;
