# Deploy the cloud Worker

Staging and production are separate Workers, D1 databases and WorkOS environments. A Worker accepts access tokens only from its own environment's WorkOS client: the JWKS is fetched per client ID, and the issuer and audience are checked on every token.

## WorkOS, once per environment

1. Add a JWT template to the environment that sets the audience, for example `{ "aud": "https://cloud.origin89.com" }` in production. AuthKit session tokens carry no `aud` without it, and the Worker rejects tokens with no audience or the wrong one.
2. Sign in once and decode the access token. Copy its `iss` exactly, including any trailing slash, into `WORKOS_ISSUER`. It changes if the environment moves to a custom AuthKit domain.
3. Keep the API key in the team vault. It is set only as the Worker secret below: never in the app, GitHub or Git.

## Cloudflare

Copy `.env.staging.example` or `.env.production.example` in this directory to `.env.staging` or `.env.production` and fill in the account, Worker name, hostname and existing D1 database. These values are public; the files are ignored by Git. Create the database first with `pnpm exec wrangler d1 create <name>` if it does not exist. These commands do not provision anything else.

From the repository root:

```sh
just deploy staging
pnpm --filter origin89-cloud exec wrangler secret put WORKOS_API_KEY --config wrangler.deploy.json
```

`just deploy` runs the checks, writes `wrangler.deploy.json` for that environment, applies D1 migrations and deploys. It refuses a client ID that belongs to the other environment. Set the secret after the first deployment and again only to rotate it; deployments keep it. Until it is set, the Worker answers every request with `500` rather than accepting tokens.

Deployment from GitHub Actions waits for deployment environments, which need the repository to be public or the organization to be upgraded. When it lands, GitHub holds only the organization `CLOUDFLARE_API_TOKEN` and these public values as variables.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, fill in the staging issuer, audience and API key, apply migrations to the local D1 with `pnpm --filter origin89-cloud exec wrangler d1 migrations apply origin89-cloud --local`, then run `just dev`.
