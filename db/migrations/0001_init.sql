-- Euron Open Email Engine: initial schema.
--
-- One migration, applied by db/migrate.ts (checksummed; never edit it after it has been
-- applied anywhere, add 0002_*.sql instead). Every tenant-scoped table carries tenant_id and
-- every query filters on it. Timestamps are UTC `timestamp(3)` (the API pins TZ=UTC and
-- reads them as UTC). apps/api/prisma/schema.prisma describes the same tables so
-- `pnpm --filter @open-email/api gen:types` can regenerate the Kysely types.

CREATE SCHEMA IF NOT EXISTS "public";

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "operator_role" AS ENUM ('SUPERADMIN', 'OPERATOR');
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING');
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "entitlement_source" AS ENUM ('PLAN', 'ADMIN');
CREATE TYPE "storage_provider" AS ENUM ('S3', 'LOCAL');
CREATE TYPE "email_domain_status" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'DISABLED');
CREATE TYPE "email_identity_status" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "email_category" AS ENUM ('TRANSACTIONAL', 'NOTIFICATION', 'MARKETING');
CREATE TYPE "email_message_status" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'REJECTED', 'FAILED', 'SUPPRESSED');
CREATE TYPE "email_suppression_reason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE', 'ADMIN_BLOCK', 'IMPORTED');
CREATE TYPE "email_sending_status" AS ENUM ('ACTIVE', 'WARNING', 'THROTTLED', 'PAUSED');
CREATE TYPE "contact_status" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'PENDING_CONFIRMATION');
CREATE TYPE "contact_source" AS ENUM ('MANUAL', 'IMPORT', 'FORM', 'API');
CREATE TYPE "list_member_status" AS ENUM ('subscribed', 'pending', 'unsubscribed');
CREATE TYPE "custom_field_type" AS ENUM ('text', 'number', 'date', 'boolean');
CREATE TYPE "campaign_status" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED', 'SENT', 'CANCELLED', 'FAILED');
CREATE TYPE "recipient_status" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'SKIPPED', 'FAILED');
CREATE TYPE "import_status" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'DONE', 'FAILED');
CREATE TYPE "email_event_type" AS ENUM ('SEND', 'DELIVERY', 'BOUNCE', 'COMPLAINT', 'REJECT', 'OPEN', 'CLICK', 'UNSUBSCRIBE');

-- ─── Operator plane (tier 1) ─────────────────────────────────────────────────

CREATE TABLE "operator_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "operator_role" NOT NULL DEFAULT 'OPERATOR',
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operator_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "operator_users_email_key" ON "operator_users"("email");
CREATE INDEX "operator_users_status_idx" ON "operator_users"("status");

-- A plan is a sales artifact: the modules it unlocks and its limits
-- (monthlyEmails, maxContacts, maxDomains, maxUsers; a missing or null limit is unlimited).
-- Tenants never read it at runtime; they carry a snapshot in tenant_entitlements.
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "modules" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

CREATE TABLE "operator_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_operator_id" TEXT,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tenant_id" TEXT,
    "resource_id" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operator_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "operator_audit_logs_created_at_idx" ON "operator_audit_logs"("created_at");
CREATE INDEX "operator_audit_logs_tenant_id_created_at_idx" ON "operator_audit_logs"("tenant_id", "created_at");

-- ─── Tenancy (tier 2) ────────────────────────────────────────────────────────

CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan_key" TEXT,
    "brand_color" TEXT NOT NULL DEFAULT '#2563eb',
    -- IANA zone the UI shows schedule times in; the API stores and compares UTC only.
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    -- Postal address printed in every marketing footer (CAN-SPAM, GDPR identification).
    "company_address" TEXT,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "email_sending_status" "email_sending_status" NOT NULL DEFAULT 'ACTIVE',
    "email_sending_status_changed_at" TIMESTAMP(3),
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- What a tenant may use right now. Written from a plan snapshot or an operator override.
CREATE TABLE "tenant_entitlements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit_value" INTEGER,
    "source" "entitlement_source" NOT NULL DEFAULT 'PLAN',
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_entitlements_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "tenant_entitlements_tenant_id_code_key" ON "tenant_entitlements"("tenant_id", "code");
CREATE INDEX "tenant_entitlements_tenant_id_idx" ON "tenant_entitlements"("tenant_id");

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "permissions" JSONB,
    "avatar_color" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");
CREATE INDEX "users_email_idx" ON "users"("email");

CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "roles_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles"("tenant_id", "key");

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "notifications_tenant_user_created_idx" ON "notifications"("tenant_id", "user_id", "created_at");

CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "uploaded_by" TEXT,
    "storage" "storage_provider" NOT NULL DEFAULT 'LOCAL',
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "files_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "files_tenant_id_entity_idx" ON "files"("tenant_id", "entity_type", "entity_id");

-- Emails sent per calendar month (UTC). One row per tenant and month; the sender
-- reserves quota with a single conditional UPDATE so concurrent workers cannot overshoot.
CREATE TABLE "tenant_usage_monthly" (
    "tenant_id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "emails_sent" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_usage_monthly_pkey" PRIMARY KEY ("tenant_id", "month"),
    CONSTRAINT "tenant_usage_monthly_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- ─── Sending infrastructure ──────────────────────────────────────────────────

CREATE TABLE "email_sending_domains" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "mail_from_subdomain" TEXT,
    "ses_configuration_set" TEXT,
    "status" "email_domain_status" NOT NULL DEFAULT 'PENDING',
    "dkim_status" TEXT,
    "mail_from_status" TEXT,
    "dns_records" JSONB,
    -- Where links and the open pixel are served from (track.<domain>); its CNAME is a DNS record.
    "tracking_domain" TEXT NOT NULL,
    "tracking_status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("tracking_status" IN ('PENDING', 'VERIFIED')),
    "failure_reason" TEXT,
    "verified_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_sending_domains_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_sending_domains_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "email_sending_domains_tenant_id_idx" ON "email_sending_domains"("tenant_id");
-- A domain belongs to exactly one tenant: SES identities are unique per account.
CREATE UNIQUE INDEX "email_sending_domains_subdomain_key" ON "email_sending_domains"(lower("subdomain"));

CREATE TABLE "email_sender_identities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sending_domain_id" TEXT NOT NULL,
    "email_address" TEXT NOT NULL,
    "display_name" TEXT,
    "reply_to" TEXT,
    "status" "email_identity_status" NOT NULL DEFAULT 'ACTIVE',
    "is_default_transactional" BOOLEAN NOT NULL DEFAULT false,
    "is_default_notification" BOOLEAN NOT NULL DEFAULT false,
    "is_default_marketing" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_sender_identities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_sender_identities_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "email_sender_identities_domain_fkey" FOREIGN KEY ("sending_domain_id") REFERENCES "email_sending_domains"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "email_sender_identities_tenant_email_key" ON "email_sender_identities"("tenant_id", lower("email_address"));
CREATE INDEX "email_sender_identities_tenant_id_idx" ON "email_sender_identities"("tenant_id");

-- ─── Audience ────────────────────────────────────────────────────────────────

CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "status" "contact_status" NOT NULL DEFAULT 'SUBSCRIBED',
    "source" "contact_source" NOT NULL DEFAULT 'MANUAL',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "last_opened_at" TIMESTAMP(3),
    "last_clicked_at" TIMESTAMP(3),
    "emails_received" INTEGER NOT NULL DEFAULT 0,
    "consent_at" TIMESTAMP(3),
    "consent_ip_hash" TEXT,
    "unsubscribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contacts_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "contacts_email_lower_chk" CHECK ("email" = lower("email"))
);
CREATE UNIQUE INDEX "contacts_tenant_id_email_key" ON "contacts"("tenant_id", "email");
CREATE INDEX "contacts_tenant_status_idx" ON "contacts"("tenant_id", "status");
CREATE INDEX "contacts_tenant_created_idx" ON "contacts"("tenant_id", "created_at" DESC, "id" DESC);
CREATE INDEX "contacts_tags_idx" ON "contacts" USING GIN ("tags");

CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "custom_field_type" NOT NULL DEFAULT 'text',
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custom_fields_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "custom_fields_tenant_id_key_key" ON "custom_fields"("tenant_id", "key");

CREATE TABLE "lists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "double_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lists_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lists_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "lists_tenant_id_idx" ON "lists"("tenant_id");

CREATE TABLE "list_members" (
    "tenant_id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "list_member_status" NOT NULL DEFAULT 'subscribed',
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "list_members_pkey" PRIMARY KEY ("list_id", "contact_id"),
    CONSTRAINT "list_members_list_fkey" FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE CASCADE,
    CONSTRAINT "list_members_contact_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
);
CREATE INDEX "list_members_tenant_contact_idx" ON "list_members"("tenant_id", "contact_id");

CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "rules" JSONB NOT NULL,
    "contact_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "segments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "segments_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "segments_tenant_id_idx" ON "segments"("tenant_id");

CREATE TABLE "subscribe_forms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "button_label" TEXT NOT NULL DEFAULT 'Subscribe',
    "success_message" TEXT NOT NULL DEFAULT 'Thanks for subscribing.',
    "collect_name" BOOLEAN NOT NULL DEFAULT false,
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscribe_forms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscribe_forms_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "subscribe_forms_list_fkey" FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "subscribe_forms_slug_key" ON "subscribe_forms"("slug");
CREATE INDEX "subscribe_forms_tenant_id_idx" ON "subscribe_forms"("tenant_id");

CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_id" TEXT,
    "status" "import_status" NOT NULL DEFAULT 'UPLOADED',
    "list_id" TEXT,
    "mapping" JSONB,
    "update_existing" BOOLEAN NOT NULL DEFAULT true,
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_jobs_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "import_jobs_tenant_created_idx" ON "import_jobs"("tenant_id", "created_at");

-- ─── Templates and campaigns ─────────────────────────────────────────────────

CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT NOT NULL DEFAULT '',
    "html" TEXT NOT NULL,
    "text_body" TEXT,
    "is_starter" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "templates_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "templates_tenant_id_idx" ON "templates"("tenant_id");

CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "campaign_status" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "preheader" TEXT NOT NULL DEFAULT '',
    "html" TEXT NOT NULL DEFAULT '',
    "template_id" TEXT,
    "sender_identity_id" TEXT,
    "audience" JSONB NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "paused_reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaigns_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "campaigns_template_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL,
    CONSTRAINT "campaigns_sender_fkey" FOREIGN KEY ("sender_identity_id") REFERENCES "email_sender_identities"("id") ON DELETE SET NULL
);
CREATE INDEX "campaigns_tenant_status_idx" ON "campaigns"("tenant_id", "status");
-- The scheduler's due-campaign scan.
CREATE INDEX "campaigns_due_idx" ON "campaigns"("scheduled_at") WHERE "status" = 'SCHEDULED';

CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category" "email_category" NOT NULL DEFAULT 'NOTIFICATION',
    "sending_domain_id" TEXT,
    "sender_identity_id" TEXT,
    "campaign_id" TEXT,
    "contact_id" TEXT,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "subject" TEXT,
    "ses_message_id" TEXT,
    "status" "email_message_status" NOT NULL DEFAULT 'QUEUED',
    -- True when the simulator handled the send instead of SES (local runs and tests).
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT,
    -- Every open, machine ones included; machine ones are flagged on the event row.
    "open_count" INTEGER NOT NULL DEFAULT 0,
    -- Human clicks only (link scanners are flagged on the event and not counted).
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "bounce_type" TEXT,
    "bounce_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "bounced_at" TIMESTAMP(3),
    "complained_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_messages_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "email_messages_campaign_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL,
    CONSTRAINT "email_messages_contact_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL
);
CREATE INDEX "email_messages_tenant_created_idx" ON "email_messages"("tenant_id", "created_at" DESC, "id" DESC);
CREATE INDEX "email_messages_tenant_status_idx" ON "email_messages"("tenant_id", "status");
CREATE INDEX "email_messages_campaign_idx" ON "email_messages"("campaign_id");
CREATE INDEX "email_messages_contact_idx" ON "email_messages"("contact_id");
CREATE INDEX "email_messages_ses_message_idx" ON "email_messages"("ses_message_id");
-- A retry of the same logical send (one campaign and contact) can never create a second message.
CREATE UNIQUE INDEX "email_messages_idempotency_key" ON "email_messages"("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;

CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "email" TEXT NOT NULL,
    "status" "recipient_status" NOT NULL DEFAULT 'QUEUED',
    "message_id" TEXT,
    "skip_reason" TEXT,
    -- Set while a worker owns the row; a claim older than a few minutes is taken over.
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaign_recipients_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "campaign_recipients_campaign_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE,
    CONSTRAINT "campaign_recipients_contact_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "campaign_recipients_campaign_contact_key" ON "campaign_recipients"("campaign_id", "contact_id");
CREATE INDEX "campaign_recipients_campaign_status_idx" ON "campaign_recipients"("campaign_id", "status", "id");

CREATE TABLE "campaign_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaign_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaign_links_campaign_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "campaign_links_campaign_url_key" ON "campaign_links"("campaign_id", "url");
CREATE UNIQUE INDEX "campaign_links_campaign_token_key" ON "campaign_links"("campaign_id", "token");

-- Suppression is per address and category scope. NULL scope means every category, and
-- PostgreSQL 14 treats NULLs as distinct, so uniqueness is two partial indexes.
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "email_suppression_reason" NOT NULL,
    "category_scope" "email_category",
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_suppressions_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "email_suppressions_email_lower_chk" CHECK ("email" = lower("email"))
);
CREATE UNIQUE INDEX "email_suppressions_scoped_key" ON "email_suppressions"("tenant_id", "email", "category_scope") WHERE "category_scope" IS NOT NULL;
CREATE UNIQUE INDEX "email_suppressions_global_key" ON "email_suppressions"("tenant_id", "email") WHERE "category_scope" IS NULL;
CREATE INDEX "email_suppressions_tenant_created_idx" ON "email_suppressions"("tenant_id", "created_at" DESC, "id" DESC);

CREATE TABLE "email_reputation_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_status" "email_sending_status" NOT NULL,
    "to_status" "email_sending_status" NOT NULL,
    "trigger" TEXT NOT NULL,
    "reason" TEXT,
    "rates_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_reputation_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_reputation_events_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "email_reputation_events_tenant_created_idx" ON "email_reputation_events"("tenant_id", "created_at");

CREATE TABLE "email_domain_health_checks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sending_domain_id" TEXT NOT NULL,
    "dkim_status" TEXT,
    "mail_from_status" TEXT,
    "spf_present" BOOLEAN NOT NULL DEFAULT false,
    "dmarc_present" BOOLEAN NOT NULL DEFAULT false,
    "failures" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_domain_health_checks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_domain_health_checks_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "email_domain_health_checks_domain_fkey" FOREIGN KEY ("sending_domain_id") REFERENCES "email_sending_domains"("id") ON DELETE CASCADE
);
CREATE INDEX "email_domain_health_checks_domain_created_idx" ON "email_domain_health_checks"("sending_domain_id", "created_at");

-- Every send, delivery, bounce, complaint, open, click and unsubscribe. campaign_id and
-- contact_id are denormalised so campaign reports and the dashboard never join.
CREATE TABLE "email_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "contact_id" TEXT,
    "type" "email_event_type" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "detail" TEXT,
    "url" TEXT,
    "machine" BOOLEAN NOT NULL DEFAULT false,
    "ip_hash" TEXT,
    "ua_class" TEXT,
    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_events_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "email_events_message_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE
);
CREATE INDEX "email_events_tenant_type_time_idx" ON "email_events"("tenant_id", "type", "occurred_at");
CREATE INDEX "email_events_message_idx" ON "email_events"("message_id", "occurred_at");
CREATE INDEX "email_events_campaign_type_time_idx" ON "email_events"("campaign_id", "type", "occurred_at") WHERE "campaign_id" IS NOT NULL;
-- SES delivers each event at least once. These types happen once per message, so a replay
-- is dropped by the insert and its side effects (counters, reputation) run once.
CREATE UNIQUE INDEX "email_events_once_key" ON "email_events"("message_id", "type") WHERE "type" IN ('SEND', 'DELIVERY', 'BOUNCE', 'COMPLAINT', 'REJECT', 'UNSUBSCRIBE');
