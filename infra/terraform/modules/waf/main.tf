# One WAF web ACL (CLOUDFRONT scope, so it must be created in us-east-1: pass that
# provider) shared by the app and console distributions:
#
#   - AWS managed common rule set and known-bad-inputs rule set
#   - a per-IP rate limit for everything except the public mail paths: the open pixel
#     (/t/o/), the click redirect (/t/c/), the unsubscribe page and RFC 8058 one-click
#     POST (/u/) and the web-view page (/w/). They are hit by mailbox providers' image
#     proxies (Apple Mail Privacy Protection, Gmail) and link scanners from a handful of
#     addresses in bursts, with no cookie and often no User-Agent, and a blocked pixel
#     or one-click unsubscribe is a lost event or a compliance failure. The API rate
#     limits those routes itself and answers with the same response for any token.
#
# Rules that would block legitimate email content only count: templates and campaign
# bodies are HTML (CrossSiteScripting_BODY), CSV imports pass the 8 KB body inspection
# limit (SizeRestrictions_BODY), and bodies routinely hold URLs and paths
# (GenericLFI_BODY, GenericRFI_BODY, EC2MetaDataSSRF_BODY). A pixel request without a
# User-Agent header (NoUserAgent_HEADER) only counts too. The API never renders stored
# content unescaped, opens a path or fetches a URL from a body.
resource "aws_wafv2_web_acl" "this" {
  #checkov:skip=CKV2_AWS_31:WAF logging needs a Firehose or bucket the operator chooses; sampled requests and metrics are on.
  name  = "${var.name_prefix}-edge"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "common"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        dynamic "rule_action_override" {
          for_each = ["SizeRestrictions_BODY", "CrossSiteScripting_BODY", "GenericLFI_BODY", "GenericRFI_BODY", "EC2MetaDataSSRF_BODY", "NoUserAgent_HEADER"]
          content {
            name = rule_action_override.value
            action_to_use {
              count {}
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit"
    priority = 3
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5_minutes
        aggregate_key_type = "IP"
        scope_down_statement {
          not_statement {
            statement {
              regex_match_statement {
                regex_string = "^/(t/o|t/c|u|w)/"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-edge"
    sampled_requests_enabled   = true
  }
}
