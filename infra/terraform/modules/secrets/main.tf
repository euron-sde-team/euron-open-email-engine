# Application secrets in Secrets Manager. ECS injects them into the api and migrate
# containers as environment variables; the values never appear in a task definition
# or a log.
#
#   <prefix>/app        JWT_SECRET: 64 random characters, signs every session token.
#                       EMAIL_UNSUBSCRIBE_SIGNING_SECRET and EMAIL_TRACKING_SIGNING_SECRET:
#                       64 random characters each, sign the public unsubscribe,
#                       confirmation, web-view and open/click tracking links.
#                       The API refuses to start in production without them. Rotating
#                       JWT_SECRET signs everyone out; rotating a signing
#                       secret invalidates every link already sent (unsubscribe links in
#                       old mail stop working), so it is a procedure, not a re-roll.
#
# REDIS_URL lives in the cache module's secret and PG_DATABASE_PASSWORD in the
# database module's, next to what they belong to.
resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "unsubscribe" {
  length  = 64
  special = false
}

resource "random_password" "tracking" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV2_AWS_57:Signing and data-encryption keys; rotating them signs everyone out, breaks links already sent or needs re-encryption, so it is an operator procedure, not a Lambda.
  name                    = "${var.name_prefix}/app"
  description             = "JWT, credential-encryption and link-signing secrets for the email engine API"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    JWT_SECRET = coalesce(var.jwt_secret, random_password.jwt.result)
    # Names as the API reads them (apps/api/src/config/index.ts).
    EMAIL_UNSUBSCRIBE_SIGNING_SECRET = coalesce(var.unsubscribe_signing_secret, random_password.unsubscribe.result)
    EMAIL_TRACKING_SIGNING_SECRET    = coalesce(var.tracking_signing_secret, random_password.tracking.result)
  })

  # Rotation happens out of band (put a new version by hand or by pipeline). Without
  # this, the next `terraform apply` would quietly roll the values back.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

locals {
  refs = concat(
    [for k in ["EMAIL_TRACKING_SIGNING_SECRET", "EMAIL_UNSUBSCRIBE_SIGNING_SECRET", "JWT_SECRET"] : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
  )
}
