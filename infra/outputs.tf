output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "table_name" {
  value = aws_dynamodb_table.seen.name
}

output "log_group" {
  value = aws_cloudwatch_log_group.lambda.name
}

output "schedule" {
  value = "${aws_scheduler_schedule.daily.schedule_expression} ${aws_scheduler_schedule.daily.schedule_expression_timezone}"
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}