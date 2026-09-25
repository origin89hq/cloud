# Origin89 cloud

The Origin89 cloud service: accounts, sites and controller membership, and later invitations and the readings controllers push. It is not needed to set up or use a controller; phones pair and operate controllers locally without an account.

The controller stays the only authority over who may operate it. This service identifies people with WorkOS and records which sites they belong to. It never holds a controller's setup secret or client keys, and nothing here grants access to a controller. Design and decisions: [internal-research#1](https://github.com/origin89hq/internal-research/issues/1).

- `apps/cloud`: the Cloudflare Worker and its D1 schema. See [deployment](apps/cloud/DEPLOYMENT.md).
- `packages/cloud`: `@origin89/cloud`, the versioned API contract the apps pin. See [its README](packages/cloud/README.md) and [releases](docs/releases.md).

```sh
pnpm install
just check
```

See [contributing](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
