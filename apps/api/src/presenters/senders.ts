import type { EmailSenderIdentityRow } from "../repositories/email-identities.repository";
import { isoReq } from "./common";

// SenderIdentity in @open-email/types.
export const toSenderDto = (r: EmailSenderIdentityRow) => ({
  id: r.id,
  domainId: r.sending_domain_id,
  email: r.email_address,
  displayName: r.display_name,
  replyTo: r.reply_to,
  status: r.status,
  defaults: [
    ...(r.is_default_transactional ? (["TRANSACTIONAL"] as const) : []),
    ...(r.is_default_notification ? (["NOTIFICATION"] as const) : []),
    ...(r.is_default_marketing ? (["MARKETING"] as const) : []),
  ] as Array<"TRANSACTIONAL" | "NOTIFICATION" | "MARKETING">,
  createdAt: isoReq(r.created_at),
});
