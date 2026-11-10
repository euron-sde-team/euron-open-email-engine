import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { BadRequestError } from "../errors";
import contactsService from "../services/contacts.service";
import formsService from "../services/forms.service";
import importsService, { IMPORT_MAX_BYTES } from "../services/imports.service";
import listsService from "../services/lists.service";
import segmentsService from "../services/segments.service";
import { asyncHandler } from "../utils/asynchandler";
import { created, ctx, ok, str } from "../utils/route";

const q = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

// ─── /contacts ───────────────────────────────────────────────────────────────

export const contactsRouter = Router();
contactsRouter.get("/", asyncHandler(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await contactsService.list(tenantId, { q: q(req.query.q), status: q(req.query.status), tag: q(req.query.tag), listId: q(req.query.listId), segmentId: q(req.query.segmentId), cursor: q(req.query.cursor), limit: req.query.limit }));
}));
contactsRouter.post("/", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await contactsService.create(tenantId, actorId, req.body ?? {}), "Contact added");
}));
// Static routes before /:id.
contactsRouter.post("/bulk", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await contactsService.bulk(tenantId, actorId, req.body ?? {}));
}));
contactsRouter.get("/export.csv", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  res.status(200).set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="contacts.csv"', "Cache-Control": "no-store" });
  await contactsService.exportCsv(tenantId, (chunk) => void res.write(chunk));
  res.end();
  void actorId;
}));
contactsRouter.get("/:id/timeline", asyncHandler(async (req, res) => ok(res, await contactsService.timeline(ctx(req).tenantId, String(req.params.id)))));
contactsRouter.get("/:id", asyncHandler(async (req, res) => ok(res, await contactsService.get(ctx(req).tenantId, String(req.params.id)))));
contactsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await contactsService.update(tenantId, actorId, String(req.params.id), req.body ?? {}));
}));
contactsRouter.delete("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await contactsService.remove(tenantId, actorId, String(req.params.id)), "Contact deleted");
}));

// ─── /custom-fields ──────────────────────────────────────────────────────────

export const customFieldsRouter = Router();
customFieldsRouter.get("/", asyncHandler(async (req, res) => ok(res, await listsService.fields(ctx(req).tenantId))));
customFieldsRouter.post("/", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await listsService.createField(tenantId, actorId, req.body ?? {}));
}));
customFieldsRouter.delete("/:key", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await listsService.removeField(tenantId, actorId, String(req.params.key)));
}));

// ─── /lists ──────────────────────────────────────────────────────────────────

export const listsRouter = Router();
listsRouter.get("/", asyncHandler(async (req, res) => ok(res, await listsService.list(ctx(req).tenantId))));
listsRouter.post("/", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await listsService.create(tenantId, actorId, req.body ?? {}));
}));
listsRouter.post("/:id/members", asyncHandler(async (req, res) => ok(res, await listsService.addMembers(ctx(req).tenantId, String(req.params.id), req.body?.contactIds))));
listsRouter.delete("/:id/members", asyncHandler(async (req, res) => ok(res, await listsService.removeMembers(ctx(req).tenantId, String(req.params.id), req.body?.contactIds))));
listsRouter.get("/:id", asyncHandler(async (req, res) => ok(res, await listsService.get(ctx(req).tenantId, String(req.params.id)))));
listsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await listsService.update(tenantId, actorId, String(req.params.id), req.body ?? {}));
}));
listsRouter.delete("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await listsService.remove(tenantId, actorId, String(req.params.id)), "List deleted");
}));

// ─── /segments ───────────────────────────────────────────────────────────────

export const segmentsRouter = Router();
segmentsRouter.get("/", asyncHandler(async (req, res) => ok(res, await segmentsService.list(ctx(req).tenantId, req.query.count === "true"))));
segmentsRouter.post("/", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await segmentsService.create(tenantId, actorId, req.body ?? {}));
}));
segmentsRouter.post("/preview", asyncHandler(async (req, res) => ok(res, await segmentsService.preview(ctx(req).tenantId, req.body?.rules))));
segmentsRouter.get("/:id", asyncHandler(async (req, res) => ok(res, await segmentsService.get(ctx(req).tenantId, String(req.params.id), req.query.count === "true"))));
segmentsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await segmentsService.update(tenantId, actorId, String(req.params.id), req.body ?? {}));
}));
segmentsRouter.delete("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await segmentsService.remove(tenantId, actorId, String(req.params.id)), "Segment deleted");
}));

// ─── /forms ──────────────────────────────────────────────────────────────────

export const formsRouter = Router();
formsRouter.get("/", asyncHandler(async (req, res) => ok(res, await formsService.list(ctx(req).tenantId))));
formsRouter.post("/", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await formsService.create(tenantId, actorId, req.body ?? {}));
}));
formsRouter.get("/:id", asyncHandler(async (req, res) => ok(res, await formsService.get(ctx(req).tenantId, String(req.params.id)))));
formsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await formsService.update(tenantId, actorId, String(req.params.id), req.body ?? {}));
}));
formsRouter.delete("/:id", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await formsService.remove(tenantId, actorId, String(req.params.id)), "Form deleted");
}));

// ─── /imports ────────────────────────────────────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 10 } });
const oneFile = (req: Request, res: Response, next: NextFunction) =>
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(new BadRequestError(err.code === "LIMIT_FILE_SIZE" ? "The file is larger than 10 MB" : "Upload a single CSV file in the `file` field"));
    }
    next(err);
  });

export const importsRouter = Router();
importsRouter.get("/", asyncHandler(async (req, res) => ok(res, await importsService.list(ctx(req).tenantId, { cursor: str(req.query.cursor), limit: req.query.limit }))));
importsRouter.post("/", oneFile, asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  created(res, await importsService.upload(tenantId, actorId, req.file), "File uploaded");
}));
importsRouter.post("/:id/start", asyncHandler(async (req, res) => {
  const { tenantId, actorId } = ctx(req);
  ok(res, await importsService.start(tenantId, actorId, String(req.params.id), req.body ?? {}), "Import started");
}));
importsRouter.get("/:id", asyncHandler(async (req, res) => ok(res, await importsService.get(ctx(req).tenantId, String(req.params.id)))));
