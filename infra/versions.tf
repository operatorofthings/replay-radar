terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
}
provider "aws" {
  region = var.region
  default_tags { tags = { Project = var.name, ManagedBy = "Terraform" } }
}
provider "aws" {
  alias  = "edge"
  region = "us-east-1"
  default_tags { tags = { Project = var.name, ManagedBy = "Terraform" } }
}
variable "region" { default = "eu-central-1" }
variable "name" { default = "replay-radar" }
variable "budget_email" {
  type        = string
  default     = ""
  description = "Optional email receiving the monthly USD 5 budget warning."
}
variable "config_parameter_name" {
  type        = string
  default     = "/replay-radar/config"
  description = "Pre-existing SecureString with steamApiKey, aliasSalt and optional allowedSteamIds. Value is never read by Terraform."
}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
locals {
  account          = data.aws_caller_identity.current.account_id
  prefix           = "arn:${data.aws_partition.current.partition}"
  origin_parameter = "/${var.name}/origin"
  config_arn       = "${local.prefix}:ssm:${var.region}:${local.account}:parameter${var.config_parameter_name}"
  origin_arn       = "${local.prefix}:ssm:${var.region}:${local.account}:parameter${local.origin_parameter}"
  environment = {
    NODE_ENV         = "production"
    STATE_TABLE      = aws_dynamodb_table.state.name
    QUEUE_URL        = aws_sqs_queue.scans.url
    CONFIG_PARAMETER = var.config_parameter_name
    ORIGIN_PARAMETER = local.origin_parameter
  }
}
