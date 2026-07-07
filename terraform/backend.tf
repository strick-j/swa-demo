# Encrypted remote state backend (S3). Backend blocks can't use variables, so the
# values are inline — EDIT `bucket` to a globally-unique bucket you created (see
# docs/RUNBOOK.md "Encrypted remote state"), then run the one-time migration:
#
#   terraform init -migrate-state     # answer "yes" to copy local state up
#
# `encrypt = true` SSE-encrypts the state object (it holds the generated SSH
# private key); `use_lockfile = true` uses S3-native state locking (needs
# Terraform >= 1.10 — for older TF, swap it for `dynamodb_table = "..."`).
terraform {
  backend "s3" {
    bucket       = "CHANGEME-swa-demo-tfstate" # <-- your globally-unique bucket
    key          = "swa-demo/terraform.tfstate"
    region       = "us-east-2"
    encrypt      = true
    use_lockfile = true
  }
}
