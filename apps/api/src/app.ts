import compression from "compression";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import config from "./config";
import { NotFoundError } from "./errors";
import { serveLocalFile } from "./services/storage.service";
import { globalErrorHandler } from "./middlewares/error-handler.middleware";
import { globalApiLimiter } from "./middlewares/rate-limit.middleware";
import operatorRootRouter from "./routes/operator";
import rootRouter from "./routes";
import publicRouter from "./routes/public.route";
// Registers the campaign-sending and import handlers on the work queue, and the reputation pause hook.
import "./services/campaign-sender.service";
import "./services/imports.service";

const app = express();

app.set("trust proxy", config.TRUST_PROXY);

// Liveness probe for the load balancer. Before all middleware/auth so health
// polls are never gated.
app.get("/up", (_req: Request, res: Response) => res.status(200).send("OK"));

// CORS: only the configured app origins (CORS_ORIGINS, by default the two
// SPAs). Other origins get no CORS headers, so browsers block the response.
// Server-to-server callers (ingest, webhooks) send no Origin and are unaffected.
const allowedOrigins = new Set(config.CORS_ORIGINS);
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Origin"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// gzip/deflate on responses above the 1KB default threshold. Mounted before the
// routers so it covers the list endpoints, which dominate response bytes.
app.use(compression());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);



// Local-disk storage driver (no AWS_S3_BUCKET): files are served only through
// short-lived signed links minted by storageService.getDownloadUrl.
app.get("/local-files/*key", serveLocalFile);

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "open-email-api", at: new Date().toISOString() });
});

// Public pages and tracking (/t /u /w /f /c) sit at the root, BEFORE the global limiter:
// mail clients and proxies fetch them in bursts and have their own, looser limiters.
app.use(publicRouter);

// Broad per-IP backstop for the tenant and operator APIs. Route-level limiters (auth,
// forms) add stricter buckets on top.
app.use(globalApiLimiter);

// Operator console (platform tier). Mounted on its own prefix BEFORE the tenant
// root router so operator auth/audit/tenants routes never collide with the
// tenant routes of the same name. Guards its own operator-JWT auth internally.
app.use("/api/v1/operator", operatorRootRouter);

app.use("/api/v1", rootRouter);

app.use((req: Request, _res: Response) => {
  throw new NotFoundError(`Route not found: ${req.method} ${req.path}`);
});

app.use(globalErrorHandler);

export default app;
