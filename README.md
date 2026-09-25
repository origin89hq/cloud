# Origin89 cloud

The Origin89 cloud service: accounts, sites, controller membership and invitations, and later the readings controllers push. It is not needed to set up or use a controller; phones pair and operate controllers locally without an account.

No code yet. The design and decisions are in [internal-research#1](https://github.com/origin89hq/internal-research/issues/1). The controller stays the only authority over who may operate it, and this service never holds a controller's setup secret or client keys.

```sh
just skills-sync
```

See [contributing](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
