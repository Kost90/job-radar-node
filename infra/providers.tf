provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "job-radar"
      Stack     = var.name
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

# AWS-managed key that encrypts SecureString parameters by default.
# It exists once any SecureString was created (day 4).
data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

locals {
  account_id       = data.aws_caller_identity.current.account_id
  google_key_param = "${var.ssm_prefix}google-key"
}