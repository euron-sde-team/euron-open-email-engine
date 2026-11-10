import config from "../../../config";
import type { PlanLimitsDto } from "../plan-snapshot";

export interface OnboardingEmailParams {
  adminName: string;
  adminEmail: string;
  tempPassword: string;
  workspaceName: string;
  workspaceSlug: string;
  planName: string;
  planKey: string;
  modules: string[];
  limits: PlanLimitsDto;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const fmt = (value: number | null): string => (value === null ? "Unlimited" : value.toLocaleString("en-US"));

// Welcome email for a new workspace admin. Table-free, inline-styled and short on purpose.
export const renderOnboardingEmail = (params: OnboardingEmailParams): RenderedEmail => {
  const brand = config.BRAND_NAME;
  const loginUrl = config.EMAIL_APP_URL;
  const firstName = params.adminName.trim().split(/\s+/)[0] || params.adminName;
  const subject = `Your ${params.workspaceName} workspace on ${brand} is ready`;

  const rows: Array<[string, string]> = [
    ["Plan", params.planName],
    ["Emails per month", fmt(params.limits.monthlyEmails)],
    ["Contacts", fmt(params.limits.maxContacts)],
    ["Sending domains", fmt(params.limits.maxDomains)],
    ["Team members", fmt(params.limits.maxUsers)],
  ];

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 16px;background:#ffffff;color:#18181b;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;">
<div style="max-width:560px;margin:0 auto;">
<p style="font-size:13px;color:#6b7178;margin:0 0 24px;">${esc(brand)}</p>
<h1 style="font-size:20px;margin:0 0 12px;">Welcome, ${esc(firstName)}</h1>
<p>Your workspace <strong>${esc(params.workspaceName)}</strong> is ready. You are its administrator. Sign in with the details below and change the password under your profile.</p>
<p style="margin:20px 0;"><a href="${esc(loginUrl)}" style="color:#2563eb;">Sign in to ${esc(params.workspaceName)}</a></p>
<p style="margin:0;color:#6b7178;font-size:13px;">Email</p>
<p style="margin:0 0 12px;font-family:monospace;">${esc(params.adminEmail)}</p>
<p style="margin:0;color:#6b7178;font-size:13px;">Temporary password</p>
<p style="margin:0 0 20px;font-family:monospace;">${esc(params.tempPassword)}</p>
<div style="border-top:1px solid #e4e4e7;margin-top:20px;padding-top:12px;">
${rows.map(([k, v]) => `<p style="margin:4px 0;"><span style="color:#6b7178;">${esc(k)}:</span> ${esc(v)}</p>`).join("\n")}
</div>
</div></body></html>`;

  const text = [
    `Welcome, ${firstName}`,
    "",
    `Your workspace ${params.workspaceName} is ready. You are its administrator.`,
    `Sign in: ${loginUrl}`,
    `Email: ${params.adminEmail}`,
    `Temporary password: ${params.tempPassword}`,
    "Change the password under your profile after signing in.",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ].join("\n");

  return { subject, html, text };
};
