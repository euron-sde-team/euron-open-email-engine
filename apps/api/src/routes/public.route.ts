import { Request, Response, Router } from "express";
import { formIpLimiter, formSlugLimiter, publicLinkLimiter, trackingLimiter } from "../middlewares/rate-limit.middleware";
import formsService from "../services/forms.service";
import trackingService, { PIXEL_GIF } from "../services/tracking.service";
import { asyncHandler } from "../utils/asynchandler";
import {
  confirmedPage,
  formPage,
  formResultPage,
  invalidLinkPage,
  unsubscribeConfirmPage,
  unsubscribedPage,
} from "../utils/public-pages";

// Public, unauthenticated routes mounted at the API ROOT (not /api/v1): /t/o, /t/c, /u, /w,
// /f, /c. Emails link to them, so they must stay short and stable. Every token is HMAC-signed
// and compared in constant time; no cookies are set.
const router = Router();

const hit = (req: Request) => ({
  ip: req.ip,
  userAgent: req.headers["user-agent"],
  purpose: String(req.headers["sec-purpose"] ?? req.headers["x-moz"] ?? req.headers["purpose"] ?? ""),
});

const html = (res: Response, status: number, body: string) => {
  res.status(status).set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).send(body);
};

const wantsJson = (req: Request): boolean => /json/.test(String(req.headers["content-type"] ?? "")) || /application\/json/.test(String(req.headers.accept ?? ""));

// ─── Tracking ────────────────────────────────────────────────────────────────

router.get(
  "/t/o/:token",
  trackingLimiter,
  asyncHandler(async (req, res) => {
    await trackingService.open(String(req.params.token).replace(/\.gif$/i, ""), hit(req)).catch(() => undefined);
    res.status(200).set({ "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private", "Content-Length": String(PIXEL_GIF.length) }).end(PIXEL_GIF);
  })
);

router.get(
  "/t/c/:token",
  trackingLimiter,
  asyncHandler(async (req, res) => {
    const url = await trackingService.click(String(req.params.token), hit(req));
    if (!url) return html(res, 404, invalidLinkPage());
    res.status(302).set({ Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).end();
  })
);

// ─── Unsubscribe ─────────────────────────────────────────────────────────────

// GET shows a confirmation (mail scanners that open links must not unsubscribe anyone);
// POST unsubscribes, which is also the RFC 8058 one-click form post.
router.get(
  "/u/:token",
  publicLinkLimiter,
  asyncHandler(async (req, res) => {
    const token = String(req.params.token);
    const info = await trackingService.unsubscribeInfo(token);
    if (!info) return html(res, 400, invalidLinkPage());
    html(res, 200, unsubscribeConfirmPage(token, info.email, info.tenantName));
  })
);

router.post(
  "/u/:token",
  publicLinkLimiter,
  asyncHandler(async (req, res) => {
    const oneClick = String(req.body?.["List-Unsubscribe"] ?? "") === "One-Click";
    const info = await trackingService.unsubscribe(String(req.params.token), oneClick ? "one-click" : "page");
    if (!info) return html(res, 400, invalidLinkPage());
    if (oneClick || wantsJson(req)) {
      res.status(200).json({ success: true });
      return;
    }
    html(res, 200, unsubscribedPage(info.email, info.tenantName));
  })
);

// ─── View in browser ─────────────────────────────────────────────────────────

router.get(
  "/w/:token",
  publicLinkLimiter,
  asyncHandler(async (req, res) => {
    const body = await trackingService.view(String(req.params.token));
    if (!body) return html(res, 404, invalidLinkPage());
    // The message HTML is tenant-authored: scripts and framing are denied outright.
    res
      .status(200)
      .set({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; font-src *; sandbox",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      })
      .send(body);
  })
);

// ─── Subscribe forms ─────────────────────────────────────────────────────────

router.get(
  "/f/:slug",
  publicLinkLimiter,
  asyncHandler(async (req, res) => {
    const f = await formsService.publicView(String(req.params.slug));
    if (!f) return html(res, 404, invalidLinkPage());
    html(res, 200, formPage(f));
  })
);

router.post(
  "/f/:slug",
  formIpLimiter,
  formSlugLimiter,
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug);
    const r = await formsService.subscribe(slug, req.body ?? {}, req.ip);
    if (wantsJson(req)) {
      res.status(r.ok ? 200 : r.error === "This form is not available." ? 404 : 400).json(r.ok ? { success: true, data: { pending: r.pending, message: r.message } } : { success: false, error: { message: r.error } });
      return;
    }
    if (!r.ok) {
      const f = await formsService.publicView(slug);
      return f ? html(res, 400, formPage(f, r.error)) : html(res, 404, invalidLinkPage());
    }
    html(res, 200, formResultPage(r.pending ? "Check your inbox" : "Subscribed", r.message, r.pending));
  })
);

// ─── Double opt-in confirmation ──────────────────────────────────────────────

router.get(
  "/c/:token",
  publicLinkLimiter,
  asyncHandler(async (req, res) => {
    const r = await formsService.confirm(String(req.params.token));
    if (!r.ok) return html(res, 400, invalidLinkPage());
    html(res, 200, confirmedPage(r.tenantName ?? ""));
  })
);

export default router;
