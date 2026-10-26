# GitHub Actions -> AWS without stored keys.
# Lives in bootstrap on purpose: CI must not be able to create or widen its own roles,
# so these are applied by you, locally, like the state bucket.

variable "github_repo" {
  description = "owner/name of the repository allowed to use the roles, e.g. kostiantyn/job-radar"
  type        = string
}

variable "project_region" {
  description = "Region of the Lambda, DynamoDB table and logs (infra/ var.region)"
  type        = string
  default     = "eu-north-1"
}

variable "project_name" {
  description = "Prefix of the resources the apply role may manage (infra/ var.name)"
  type        = string
  default     = "job-radar"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  oidc_host  = "token.actions.githubusercontent.com"
  # resources of infra/, including copies like job-radar-scratch
  arn_prefix = "${var.project_region}:${local.account_id}"
}

# One per AWS account. If it already exists (e.g. from another project), import it instead.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
  # no thumbprint_list: for GitHub, IAM validates the certificate against its own trusted CAs
}

# ---- trust policies: who may assume each role ----

data "aws_iam_policy_document" "trust_plan" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    # any pull request in this repository (forks never get a token for this workflow)
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["repo:${var.github_repo}:pull_request"]
    }
  }
}

data "aws_iam_policy_document" "trust_apply" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    # only workflow runs on the main branch
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

# Role names deliberately do NOT start with "job-radar-": the apply role may manage
# roles with that prefix and must not be able to edit itself.
resource "aws_iam_role" "github_plan" {
  name                 = "github-${var.project_name}-plan"
  assume_role_policy   = data.aws_iam_policy_document.trust_plan.json
  max_session_duration = 3600
}

resource "aws_iam_role" "github_apply" {
  name                 = "github-${var.project_name}-apply"
  assume_role_policy   = data.aws_iam_policy_document.trust_apply.json
  max_session_duration = 3600
}

# ---- plan: read-only, never writes, not even the state lock (plan runs with -lock=false) ----

data "aws_iam_policy_document" "plan" {
  statement {
    sid       = "ReadState"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.state.arn}/${var.project_name}/*"]
  }

  statement {
    sid       = "ListState"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]
  }

  # what terraform refresh reads; configuration only, no table items or log events
  statement {
    sid = "DescribeProjectResources"
    actions = [
      "lambda:GetFunction*",
      "lambda:ListVersionsByFunction",
      "lambda:ListTags",
      "dynamodb:Describe*",
      "dynamodb:ListTagsOfResource",
      "logs:DescribeLogGroups",
      "logs:ListTagsForResource",
      "logs:ListTagsLogGroup",
      "scheduler:GetSchedule",
      "scheduler:ListTagsForResource",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "kms:DescribeKey",
      "kms:ListAliases",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_plan" {
  name   = "terraform-plan"
  role   = aws_iam_role.github_plan.id
  policy = data.aws_iam_policy_document.plan.json
}

# ---- apply: everything infra/ creates, limited to the project prefix ----

data "aws_iam_policy_document" "apply" {
  statement {
    sid       = "ListState"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]
  }

  statement {
    sid       = "ReadWriteStateAndLock"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/${var.project_name}/*"]
  }

  statement {
    sid       = "Lambda"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${local.arn_prefix}:function:${var.project_name}*"]
  }

  statement {
    sid = "DynamoDB"
    actions = [
      "dynamodb:CreateTable",
      "dynamodb:UpdateTable",
      "dynamodb:DeleteTable",
      "dynamodb:Describe*",
      "dynamodb:UpdateTimeToLive",
      "dynamodb:ListTagsOfResource",
      "dynamodb:TagResource",
      "dynamodb:UntagResource",
    ]
    resources = ["arn:aws:dynamodb:${local.arn_prefix}:table/${var.project_name}*"]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:*"]
    resources = ["arn:aws:logs:${local.arn_prefix}:log-group:/aws/lambda/${var.project_name}*"]
  }

  statement {
    sid       = "Scheduler"
    actions   = ["scheduler:*"]
    resources = ["arn:aws:scheduler:${local.arn_prefix}:schedule/default/${var.project_name}*"]
  }

  statement {
    sid = "ProjectRoles"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.project_name}-*"]
  }

  statement {
    sid       = "PassProjectRoles"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.project_name}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "scheduler.amazonaws.com"]
    }
  }

  statement {
    sid       = "AccountWideReads"
    actions   = ["logs:DescribeLogGroups", "kms:DescribeKey", "kms:ListAliases"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_apply" {
  name   = "terraform-apply"
  role   = aws_iam_role.github_apply.id
  policy = data.aws_iam_policy_document.apply.json
}

output "github_plan_role_arn" {
  value = aws_iam_role.github_plan.arn
}

output "github_apply_role_arn" {
  value = aws_iam_role.github_apply.arn
}