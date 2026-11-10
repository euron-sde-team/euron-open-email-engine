variable "region" {
  description = "AWS region."
  type        = string
}

variable "environment" {
  description = "Environment tag."
  type        = string
  default     = "dev"
}

variable "extra_tags" {
  description = "Tags added to every resource."
  type        = map(string)
  default     = {}
}

variable "name_prefix" {
  description = "Prefix for every resource name, 3-24 lowercase characters (e.g. \"mail-dev\")."
  type        = string
}

variable "domain" {
  description = "Host of the tenant app, e.g. mail.example.com. Its /api/* is the API."
  type        = string
}

variable "console_domain" {
  description = "Host of the operator console, e.g. console.mail.example.com."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone for both hosts (automatic certificates and DNS)."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Existing regional certificate covering both hosts, when the zone is not in Route53."
  type        = string
  default     = null
}

variable "cdn_certificate_arn" {
  description = "Existing us-east-1 certificate covering both hosts, when the zone is not in Route53."
  type        = string
  default     = null
}

variable "mail_domain" {
  description = "SES sending domain (defaults to domain)."
  type        = string
  default     = null
}

variable "tracking_host" {
  description = "EMAIL_TRACKING_HOST: where tenants' track.<domain> CNAMEs point. Null uses the tenant app host (domain)."
  type        = string
  default     = null
}

variable "image_tag" {
  description = "Image tag to deploy (make aws-deploy passes the git commit)."
  type        = string
}

variable "product_name" {
  description = "BRAND_NAME shown in emails and as the sender name."
  type        = string
  default     = "Open Email Engine"
}

variable "alarm_email" {
  description = "Alarm notification address."
  type        = string
  default     = null
}

variable "email_ses_mode" {
  description = "aws sends through SES; simulated makes no SES call and emits the delivery events itself (demo deployments only)."
  type        = string
  default     = "aws"
}

variable "email_default_tenant_tps" {
  description = "EMAIL_DEFAULT_TENANT_TPS: sends per second for one tenant."
  type        = number
  default     = 5
}

variable "email_account_tps" {
  description = "EMAIL_ACCOUNT_TPS: sends per second for the whole SES account (your SES maximum send rate)."
  type        = number
  default     = 14
}

variable "reputation_thresholds" {
  description = "Per-tenant reputation gates as fractions (0.05 is 5 percent): throttle at *_warn, pause marketing at *_pause."
  type = object({
    bounce_warn     = number
    bounce_pause    = number
    complaint_warn  = number
    complaint_pause = number
  })
  default = {
    bounce_warn     = 0.03
    bounce_pause    = 0.05
    complaint_warn  = 0.0005
    complaint_pause = 0.001
  }
}

variable "api_extra_environment" {
  description = "Extra API environment. Never secrets."
  type        = map(string)
  default     = {}
}

variable "api_extra_secrets" {
  description = "Extra ECS secrets for the API, e.g. [{ name = \"EXAMPLE_SECRET\", valueFrom = \"<secret arn>:EXAMPLE_SECRET::\" }]."
  type        = list(object({ name = string, valueFrom = string }))
  default     = []
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.small"
}

variable "cache_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "cpu_architecture" {
  description = "X86_64 or ARM64 (Graviton). ARM64 needs linux/arm64 images: PLATFORM=linux/arm64 make aws-deploy."
  type        = string
  default     = "X86_64"
}

variable "log_level" {
  description = "API LOG_LEVEL."
  type        = string
  default     = "info"
}
