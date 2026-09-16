resource "aws_dynamodb_table" "state" {
  name         = "${var.name}-state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  server_side_encryption { enabled = true }
  point_in_time_recovery { enabled = false }
}
resource "aws_sqs_queue" "dead" {
  name                      = "${var.name}-dead.fifo"
  fifo_queue                = true
  message_retention_seconds = 604800
  sqs_managed_sse_enabled   = true
}
resource "aws_sqs_queue" "scans" {
  name                       = "${var.name}-scans.fifo"
  fifo_queue                 = true
  visibility_timeout_seconds = 1080
  message_retention_seconds  = 604800
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dead.arn, maxReceiveCount = 3 })
}
resource "aws_iam_role" "lambda" {
  for_each           = toset(["api", "worker"])
  name               = "${var.name}-${each.key}"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = toset(["api", "worker"])
  name              = "/aws/lambda/${var.name}-${each.key}"
  retention_in_days = 7
}
resource "aws_iam_role_policy" "lambda" {
  for_each = toset(["api", "worker"])
  role     = aws_iam_role.lambda[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.lambda[each.key].arn}:*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"], Resource = aws_dynamodb_table.state.arn },
    { Effect = "Allow", Action = ["ssm:GetParameters"], Resource = [local.config_arn, local.origin_arn] },
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.scans.arn }
  ] })
}
resource "aws_iam_role_policy" "consume" {
  role   = aws_iam_role.lambda["worker"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.scans.arn }] })
}
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../.build/lambda"
  output_path = "${path.module}/../.build/lambda.zip"
}
resource "aws_lambda_function" "functions" {
  for_each                       = toset(["api", "worker"])
  function_name                  = "${var.name}-${each.key}"
  role                           = aws_iam_role.lambda[each.key].arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = each.key == "api" ? "index.handler" : "index.worker"
  filename                       = data.archive_file.lambda.output_path
  source_code_hash               = data.archive_file.lambda.output_base64sha256
  memory_size                    = 256
  timeout                        = each.key == "api" ? 30 : 180
  reserved_concurrent_executions = each.key == "api" ? 5 : 1
  # Bootstrap only. App releases belong to scripts/deploy-app.sh and GitHub Actions.
  lifecycle { ignore_changes = [filename, source_code_hash] }
  environment { variables = local.environment }
  depends_on = [aws_iam_role_policy.lambda, aws_iam_role_policy.consume, aws_cloudwatch_log_group.lambda]
}
resource "aws_lambda_event_source_mapping" "scan" {
  event_source_arn = aws_sqs_queue.scans.arn
  function_name    = aws_lambda_function.functions["worker"].arn
  batch_size       = 1
  enabled          = true
}
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.functions["api"].function_name
  authorization_type = "AWS_IAM"
}
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id  = "AllowCloudFrontUrl"
  action        = "lambda:InvokeFunctionUrl"
  function_name = aws_lambda_function.functions["api"].function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.site.arn
}
resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.functions["api"].function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.site.arn
}
resource "aws_ssm_parameter" "origin" {
  name  = local.origin_parameter
  type  = "String"
  value = "https://${var.domain}"
}
