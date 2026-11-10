output "app_secret_arn" {
  description = "ARN of the <prefix>/app secret (JWT_SECRET and the two link-signing secrets)."
  value       = aws_secretsmanager_secret.app.arn
}

output "secret_refs" {
  description = "ECS container `secrets` entries for the four app secrets: [{ name, valueFrom }]."
  value       = local.refs
}
