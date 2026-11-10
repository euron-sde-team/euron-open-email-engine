import { Router } from "express";
import { listAuditLogs } from "../controllers/audit.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listAuditLogs));

export default router;
