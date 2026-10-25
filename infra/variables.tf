variable "region" {
  type    = string
  default = "eu-north-1"
}

variable "name" {
  description = "Prefix for every resource name. Change it to stand up a second copy (step 9)."
  type        = string
  default     = "job-radar"
}

variable "ssm_prefix" {
  description = "SSM path that holds the secrets. Created by hand, never by Terraform."
  type        = string
  default     = "/job-radar/"

  validation {
    condition     = startswith(var.ssm_prefix, "/") && endswith(var.ssm_prefix, "/")
    error_message = "ssm_prefix must start and end with a slash, e.g. /job-radar/."
  }
}

variable "spreadsheet_id" {
  description = "Google Sheets id: not a secret, useless without the key."
  type        = string
}

variable "sheet_name" {
  type    = string
  default = "Jobs"
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  description = "Seconds."
  type        = number
  default     = 300
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "reserved_concurrency" {
  description = "1 = runs never overlap. -1 = no limit (new accounts with a low quota cannot reserve)."
  type        = number
  default     = -1
}

variable "schedule_expression" {
  type    = string
  default = "cron(0 7 * * ? *)"
}

variable "schedule_timezone" {
  type    = string
  default = "Europe/London"
}

variable "schedule_enabled" {
  type    = bool
  default = true
}