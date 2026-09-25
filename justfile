default:
    @just --list

skills-sync:
    python3 .origin89/sync-engineering.py

# Lint, build and test the contract and Worker, then bundle the Worker.
check:
    pnpm check

# Build, pack and install-test the contract package.
package:
    pnpm package

# Run the Worker locally against a local D1 and apps/cloud/.dev.vars.
dev:
    pnpm --filter origin89-cloud dev

# Write wrangler.deploy.json for staging or production from apps/cloud/.env.<environment>.
deploy-config environment:
    pnpm --filter origin89-cloud deploy:config {{environment}}

# Apply D1 migrations and deploy the checked Worker to staging or production.
deploy environment: check (deploy-config environment)
    pnpm --filter origin89-cloud deploy:remote {{environment}}
