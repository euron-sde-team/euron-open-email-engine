variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "rate_limit_per_5_minutes" {
  description = "Requests per IP per 5 minutes before the WAF blocks it (the public tracking, unsubscribe and web-view paths are exempt)."
  type        = number
  default     = 3000
}
