variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "kms_key_arn" {
  description = "CMK that encrypts the secrets. Null uses the AWS-managed key."
  type        = string
  default     = null
}

variable "recovery_window_in_days" {
  description = "Days a deleted secret stays recoverable. 0 deletes immediately (local and throwaway environments)."
  type        = number
  default     = 30
}

variable "jwt_secret" {
  description = "JWT_SECRET (at least 32 characters). Null generates one. Set only when moving an existing installation."
  type        = string
  default     = null
  sensitive   = true
  validation {
    condition     = var.jwt_secret == null || try(length(var.jwt_secret) >= 32, false)
    error_message = "jwt_secret must be at least 32 characters."
  }
}

variable "unsubscribe_signing_secret" {
  description = "EMAIL_UNSUBSCRIBE_SIGNING_SECRET (at least 32 characters). Null generates one. Pass it only when moving an existing installation, or unsubscribe links already sent stop working."
  type        = string
  default     = null
  sensitive   = true
  validation {
    condition     = var.unsubscribe_signing_secret == null || try(length(var.unsubscribe_signing_secret) >= 32, false)
    error_message = "unsubscribe_signing_secret must be at least 32 characters."
  }
}

variable "tracking_signing_secret" {
  description = "EMAIL_TRACKING_SIGNING_SECRET (at least 32 characters). Null generates one. Pass it only when moving an existing installation, or open and click links already sent stop working."
  type        = string
  default     = null
  sensitive   = true
  validation {
    condition     = var.tracking_signing_secret == null || try(length(var.tracking_signing_secret) >= 32, false)
    error_message = "tracking_signing_secret must be at least 32 characters."
  }
}
