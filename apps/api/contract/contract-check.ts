/**
 * Compile-time conformance check: the DTO mappers in src/presenters return values assignable
 * to the shapes in @open-email/types. Never run; `pnpm typecheck` compiles it.
 */
import type {
  Campaign,
  Contact,
  ContactList,
  CustomField,
  EmailTemplate,
  SenderIdentity,
  SendingDomain,
  SubscribeForm,
} from "../../../packages/types/src/index";
import { toCampaignDto } from "../src/presenters/campaigns";
import { toContactDto, toCustomFieldDto, toFormDto, toListDto } from "../src/presenters/audience";
import { toDomainDto } from "../src/presenters/domains";
import { toSenderDto } from "../src/presenters/senders";
import { toTemplateDto } from "../src/services/templates.service";

type Returns<F extends (...a: never[]) => unknown> = ReturnType<F>;

export const checks: {
  contact: Contact;
  list: ContactList;
  field: CustomField;
  form: SubscribeForm;
  domain: SendingDomain;
  sender: SenderIdentity;
  template: EmailTemplate;
  campaign: Campaign;
} = {
  contact: null as unknown as Returns<typeof toContactDto>,
  list: null as unknown as Returns<typeof toListDto>,
  field: null as unknown as Returns<typeof toCustomFieldDto>,
  form: null as unknown as Returns<typeof toFormDto>,
  domain: null as unknown as Returns<typeof toDomainDto>,
  sender: null as unknown as Returns<typeof toSenderDto>,
  template: null as unknown as Returns<typeof toTemplateDto>,
  campaign: null as unknown as Returns<typeof toCampaignDto>,
};
