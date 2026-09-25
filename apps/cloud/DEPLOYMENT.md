# Deploy the cloud Worker

Staging and production are separate Workers, D1 databases and WorkOS environments. A Worker accepts access tokens only from its own environment's WorkOS client: the JWKS is fetched per client ID, and the issuer and audience are checked on every token.

## WorkOS, once per environment

1. Add a JWT template to the environment that sets the audience, for example `{ "aud": "https://cloud.origin89.com" }` in production. AuthKit session tokens carry no `aud` without it, and the Worker rejects tokens with no audience or the wrong one.
2. Sign in once and decode the access token. Copy its `iss` exactly, including any trailing slash, into `WORKOS_ISSUER`. It changes if the environment moves to a custom AuthKit domain.
3. Keep the API key in the team vault and in the `WORKOS_API_KEY` repository secret. Never in the app or Git.

## Cloudflare

Copy `.env.staging.example` or `.env.production.example` in this directory to `.env.staging` or `.env.production` and fill it in. Create the database first with `pnpm exec wrangler d1 create <name>` if it does not exist. The file is ignored by Git; every value except `WORKOS_API_KEY` is public.

From the repository root:

```sh
just deploy production
```

`just deploy` runs the checks, writes `wrangler.deploy.json` for that environment and confirms that the database ID belongs to the named database. It applies D1 migrations, then deploys. A `WORKOS_API_KEY` in the env file is uploaded with that version through a temporary secrets file, so the first deployment needs no separate step. With the line left empty, the deploy keeps the Worker's existing secret and refuses to run if there is none. Nothing changes remotely when a check fails.

The config refuses the other environment's client ID. Worker and database names must end with `-staging` or `-production`, and only the staging hostname may contain `staging`.

## Deploy with GitHub Actions

The `Checks` workflow deploys production on every push to `main` after its checks pass, and on a manual run on `main`. PRs only run checks. It uses the same `deploy:config` and `deploy:remote` scripts as `just deploy production`, and uploads `WORKOS_API_KEY` with each version.

GitHub holds the organization secret `CLOUDFLARE_API_TOKEN` (granted to this repository), the repository secret `WORKOS_API_KEY`, and repository variables `CLOUDFLARE_ACCOUNT_ID`, `CLOUD_WORKER_NAME`, `CLOUD_HOSTNAME`, `CLOUD_DATABASE_NAME`, `CLOUD_DATABASE_ID`, `WORKOS_CLIENT_ID`, `WORKOS_ISSUER` and `WORKOS_AUDIENCE`. Without GitHub deployment environments, which this private repository cannot use on the current plan, these secrets are available to workflows on every branch, not only `main`. Move them to a `cloud-production` environment restricted to `main` once environments are available.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, fill in the staging issuer, audience and API key, apply migrations to the local D1 with `pnpm --filter origin89-cloud exec wrangler d1 migrations apply origin89-cloud --local`, then run `just dev`.
