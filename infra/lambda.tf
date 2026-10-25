data "archive_file" "lambda" {
  type             = "zip"
  source_dir       = "${path.module}/../dist"
  output_path      = "${path.module}/.build/${var.name}.zip"
  output_file_mode = "0644" # same zip hash on macOS, Linux and in CI
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  function_name = var.name
  role          = aws_iam_role.lambda.arn

  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  handler       = "index.handler"

  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256 # new build = new hash = code update

  memory_size                    = var.memory_size
  timeout                        = var.timeout
  reserved_concurrent_executions = var.reserved_concurrency

  logging_config {
    log_format            = "JSON"
    log_group             = aws_cloudwatch_log_group.lambda.name
    application_log_level = "INFO"
    system_log_level      = "INFO"
  }

  environment {
    variables = {
      TABLE_NAME       = aws_dynamodb_table.seen.name
      GOOGLE_KEY_PARAM = local.google_key_param
      SPREADSHEET_ID   = var.spreadsheet_id
      SHEET_NAME       = var.sheet_name
      NODE_OPTIONS     = "--enable-source-maps"
    }
  }

  # the role must have its permissions before the first invocation, not just exist
  depends_on = [aws_iam_role_policy.lambda]
}

# Scheduler invokes asynchronously: on a function error Lambda retries once, then gives up.
resource "aws_lambda_function_event_invoke_config" "this" {
  function_name                = aws_lambda_function.this.function_name
  maximum_retry_attempts       = 1
  maximum_event_age_in_seconds = 3600
}