variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "alarm_email" {
  description = "Address subscribed to alarm notifications (confirm the e-mail AWS sends). Null: subscribe something else to the topic."
  type        = string
  default     = null
}

variable "alb_arn_suffix" {
  description = "Load balancer ARN suffix."
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name."
  type        = string
}

variable "services" {
  description = "Services to watch: { api = { service_name, load_balanced = true, target_group_arn_suffix } }."
  type = map(object({
    service_name            = string
    load_balanced           = bool
    target_group_arn_suffix = optional(string)
  }))
}

variable "db_instance_identifier" {
  description = "RDS instance identifier."
  type        = string
}

variable "db_max_connections" {
  description = "Connection ceiling the alarm measures against."
  type        = number
  default     = 200
}

variable "jobs_log_group_name" {
  description = "Log group of the process that runs the background jobs (the api); a metric filter on it counts failed job runs."
  type        = string
}

variable "failed_jobs_threshold" {
  description = "Failed job runs in 5 minutes above which the failed-jobs alarm fires."
  type        = number
  default     = 5
}

variable "dead_letter_queue_names" {
  description = "SQS dead-letter queues to alarm on (any visible message alarms)."
  type        = list(string)
  default     = []
}

variable "ses_bounce_rate_threshold" {
  description = "SES account bounce rate (a fraction, 0.04 is 4 percent) above which the alarm fires. SES reviews the account from 0.05."
  type        = number
  default     = 0.04
}

variable "ses_complaint_rate_threshold" {
  description = "SES account complaint rate (a fraction, 0.0008 is 0.08 percent) above which the alarm fires. SES reviews the account from 0.001."
  type        = number
  default     = 0.0008
}
