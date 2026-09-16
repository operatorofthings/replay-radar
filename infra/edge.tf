resource "aws_s3_bucket" "site" {
  bucket        = "${var.name}-${local.account}-${var.region}"
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name}-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_origin_access_control" "api" {
  name                              = "${var.name}-lambda"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_wafv2_web_acl" "site" {
  provider = aws.edge
  name     = "${var.name}-edge"
  scope    = "CLOUDFRONT"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = false
    metric_name                = var.name
    sampled_requests_enabled   = false
  }
  dynamic "rule" {
    for_each = { AWSManagedRulesAmazonIpReputationList = 0, AWSManagedRulesCommonRuleSet = 1 }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"
          # OpenID legitimately carries Steam URLs in query parameters.
          dynamic "rule_action_override" {
            for_each = rule.key == "AWSManagedRulesCommonRuleSet" ? [1] : []
            content {
              name = "GenericRFI_QUERYARGUMENTS"
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = false
        metric_name                = rule.key
        sampled_requests_enabled   = false
      }
    }
  }
  rule {
    name     = "RequestRateLimit"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 500
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = false
      metric_name                = "RequestRateLimit"
      sampled_requests_enabled   = false
    }
  }
}
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "Replay Radar"
  aliases             = [var.domain]
  default_root_object = "index.html"
  web_acl_id          = aws_wafv2_web_acl.site.arn
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  origin {
    origin_id                = "static"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }
  origin {
    origin_id                = "api"
    domain_name              = trimsuffix(trimprefix(aws_lambda_function_url.api.function_url, "https://"), "/")
    origin_access_control_id = aws_cloudfront_origin_access_control.api.id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 35
    }
  }
  default_cache_behavior {
    target_origin_id       = "static"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # AWS-managed policy: no custom cache policies (compatible with the Free plan).
    cache_policy_id = data.aws_cloudfront_cache_policy.optimized.id
  }
  dynamic "ordered_cache_behavior" {
    for_each = ["/api/*", "/auth/*"]
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = "api"
      viewer_protocol_policy   = "https-only"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = true
      cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id     # Managed-CachingDisabled
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.api.id # Managed-AllViewerExceptHostHeader
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject", Resource = "${aws_s3_bucket.site.arn}/*", Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } } },
    { Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.site.arn, "${aws_s3_bucket.site.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
# Native CloudFormation bridge because the plan API was introduced in Sep 2026.
# No CLI/local-exec hacks, no paid-tier fallback. Subscription failure fails apply.
resource "aws_cloudformation_stack" "free_plan" {
  provider = aws.edge
  name     = "${var.name}-cloudfront-free-plan"
  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Resources = { FreePlan = {
      Type       = "AWS::PricingPlanManager::Subscription"
      Properties = { PlanFamily = "CloudFront", PlanTier = "FREE", UsageLevel = "DEFAULT", ResourceArns = [aws_cloudfront_distribution.site.arn, aws_wafv2_web_acl.site.arn, data.aws_route53_zone.site.arn] }
    } }
    Outputs = { Status = { Value = { "Fn::GetAtt" = ["FreePlan", "Status"] } } }
  })
}
output "url" { value = "https://${var.domain}" }
output "distribution_id" { value = aws_cloudfront_distribution.site.id }
output "free_plan_status" { value = aws_cloudformation_stack.free_plan.outputs["Status"] }
output "static_bucket" { value = aws_s3_bucket.site.id }
output "state_table" { value = aws_dynamodb_table.state.name }
output "dead_letter_queue" { value = aws_sqs_queue.dead.url }

data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_cache_policy" "optimized" { name = "Managed-CachingOptimized" }
data "aws_cloudfront_origin_request_policy" "api" { name = "Managed-AllViewerExceptHostHeader" }
