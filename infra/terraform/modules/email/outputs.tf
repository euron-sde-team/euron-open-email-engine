output "identity_arn" {
  description = "ARN of the verified domain identity."
  value       = aws_sesv2_email_identity.domain.arn
}

output "from_address" {
  description = "AWS_SES_FROM_EMAIL for the API."
  value       = "no-reply@${var.domain}"
}

output "configuration_set" {
  description = "SES configuration set applied to the identity."
  value       = aws_sesv2_configuration_set.this.configuration_set_name
}

output "dns_records" {
  description = "Records to publish when the zone is not in Route53."
  value = concat(
    [for t in aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens : { type = "CNAME", name = "${t}._domainkey.${var.domain}", value = "${t}.dkim.amazonses.com" }],
    [
      { type = "MX", name = local.mail_from_domain, value = "10 feedback-smtp.${data.aws_region.current.region}.amazonses.com" },
      { type = "TXT", name = local.mail_from_domain, value = "v=spf1 include:amazonses.com ~all" },
    ],
  )
}

output "configuration_set_arn" {
  description = "Configuration set ARN, for IAM policies."
  value       = aws_sesv2_configuration_set.this.arn
}

output "events_topic_arn" {
  description = "SES_EVENTS_SNS_TOPIC_ARN: the topic the tenants' configuration sets publish to."
  value       = aws_sns_topic.this["events"].arn
}

output "events_queue_url" {
  description = "SES_EVENTS_QUEUE_URL."
  value       = aws_sqs_queue.this["events"].id
}

output "queue_arns" {
  description = "ARNs of the queues the API consumes (for IAM policies)."
  value       = [for q in aws_sqs_queue.this : q.arn]
}

output "dead_letter_queue_arns" {
  description = "ARNs of the dead-letter queues (the operator console samples and counts them)."
  value       = [for q in aws_sqs_queue.dlq : q.arn]
}

output "events_topic_arns" {
  description = "ARNs of the SES topics (for IAM policies)."
  value       = [for t in aws_sns_topic.this : t.arn]
}

output "dead_letter_queue_names" {
  description = "Names of the dead-letter queues (for alarms)."
  value       = [for q in aws_sqs_queue.dlq : q.name]
}
