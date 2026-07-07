# Encrypted remote state backend (S3) for the terraform-swa module. This state is
# the MORE sensitive of the two — it holds the Conjur SCA client secret and a live
# Conjur access token (see conjur-auth.tf) — so encrypting it is the priority.
# Use the SAME bucket as the terraform/ module (different key). EDIT `bucket`,
# then migrate once:  terraform init -migrate-state
terraform {
  backend "s3" {
    bucket       = "CHANGEME-swa-demo-tfstate" # <-- same bucket as terraform/
    key          = "swa-demo/terraform-swa.tfstate"
    region       = "us-east-2"
    encrypt      = true
    use_lockfile = true
  }
}
