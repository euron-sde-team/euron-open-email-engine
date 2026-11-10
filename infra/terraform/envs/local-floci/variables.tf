variable "endpoint" {
  description = "Emulator endpoint: http://localhost:4677 from the host, http://floci:4566 inside compose."
  type        = string
  default     = "http://localhost:4677"
}

variable "name_prefix" {
  description = "Must match the SES and SQS names in deploy/compose/compose.floci.yaml."
  type        = string
  default     = "open-email-local"
}

variable "mail_domain" {
  description = "Sending domain registered in the emulator's SES (must match AWS_SES_FROM_EMAIL in deploy/compose/compose.floci.yaml)."
  type        = string
  default     = "mail.example.test"
}

variable "bucket_name" {
  description = "The file bucket (EMAIL_S3_BUCKET in deploy/compose/compose.floci.yaml)."
  type        = string
  default     = "open-email-local-files"
}

variable "app_origins" {
  description = "Browser origins of the local web app and console (CORS on the file bucket)."
  type        = list(string)
  default     = ["http://localhost:3650", "http://localhost:3660"]
}
