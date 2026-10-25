resource "aws_dynamodb_table" "seen" {
  name     = "${var.name}-seen"
  hash_key = "job_key"

  # Provisioned 1/5 stays inside the always-free 25 RCU / 25 WCU. No auto scaling.
  billing_mode   = "PROVISIONED"
  read_capacity  = 1
  write_capacity = 5

  attribute {
    name = "job_key"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}