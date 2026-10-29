# Lambda error -> CloudWatch alarm -> SNS topic -> email.
# The subscription stays "pending confirmation" until you click the link AWS emails you.

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
  # no KMS here: a topic encrypted with the AWS-managed key aws/sns cannot receive CloudWatch alarms
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Any failed invocation (an exception in the handler, a timeout, a crash during init).
# With the async retry a failed day gives 1-2 errors; one email per state change, not per error.
resource "aws_cloudwatch_metric_alarm" "errors" {
  alarm_name        = "${var.name}-errors"
  alarm_description = "job-radar failed. Logs: /aws/lambda/${var.name}"
  namespace         = "AWS/Lambda"
  metric_name       = "Errors"
  dimensions        = { FunctionName = aws_lambda_function.this.function_name }

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching" # no invocation in the hour = no errors, not "unknown"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn] # an email when it is green again
}