# Working in this repository

For hosted PR reviews, follow `Code Review Rules` below without running the local
skills refresh. For other tasks, run `just skills-sync` from the repository root.
Read `skills/origin89-working/SKILL.md` and the relevant domain skills under the
immutable `path` printed by that command. Keep that snapshot for the task; do not
refresh it halfway through work. Before branch, commit, push, or PR operations,
read `skills/origin89-commits/SKILL.md` from that snapshot. Read local instructions
and preserve stronger project constraints and project-specific skills.

If refresh reports cached content, continue with that verified cache and mention
that the script could not check for updates. If no cache is available or
validation fails, report the error; do not claim the shared rules loaded. Local
instructions and the user's request still apply. Do not overwrite local skill
files to fix a conflict without reconciling them.

[Origin89 engineering](https://github.com/origin89hq/engineering) owns the shared
rules. Keep only repository-specific architecture, commands, target constraints,
and exceptions below. Internal RFCs and research belong in
[internal-research](https://github.com/origin89hq/internal-research). Add documentation
only when its value and upkeep are clear; remove AI filler from every message.

Confirmed problems left outside the current fix need an issue in the owning
repository: search with `gh`, reuse a matching issue or create one with evidence,
and return its URL. Follow the shared working skill's unfinished-work rule.
Respect posting restrictions; if filing is blocked, provide the draft and say why.
Finish authorized fixes instead of replacing them with backlog issues.

## Project

This repository holds the Origin89 cloud service: accounts, sites, controller
membership, and later invitations and the store of readings pushed by controllers.
The design and owner decisions are in
[internal-research#1](https://github.com/origin89hq/internal-research/issues/1);
invitations and readings wait for
[km43#129](https://github.com/origin89hq/km43/issues/129).

`apps/cloud` is the Cloudflare Worker, with D1 migrations in `apps/cloud/migrations`
and tests in the Workers runtime through `@cloudflare/vitest-pool-workers`.
`packages/cloud` is the published `@origin89/cloud` contract; a consumer-visible
change needs a changeset. Run `just check` before committing and `just package`
before releasing the contract. Use `just --list` for other commands. Keep
`compatibility_date` within what the test runtime's workerd supports.

The controller is the only authority over who may operate it. This service
identifies people and records membership; it never grants controller access.
It must never receive, store, or log a controller's printed setup secret or any
client key. Account deletion, sign-out, and membership changes do not revoke a
controller enrolment; only the controller does that.

## Code Review Rules

Read the shared `origin89-review` skill and relevant domain skills when available.
In hosted review jobs that already provide `.origin89/engineering/skills/`, use
that checkout without running the local refresh. If shared context is missing,
review against the rules below and disclose that limit.

- Flag changes that bypass authorization, lose data or provenance, break a
  supported contract, or turn unknown or stale equipment input into permission
  to act. Check callers and existing guards before reporting a defect.
- Require meaningful success, invalid-input, boundary, and failure coverage for
  changed nontrivial behavior. Respect simpler contracts with fewer paths;
  hazardous behavior needs its full fault matrix and relevant bench evidence.
- For Rust domain logic, prefer typed state, errors, units, and identifiers.
  Strings at text boundaries are expected; flag strings that discard useful
  invariants or leave invalid domain states representable.
- Report the trigger, consequence, and precise location. Distinguish checks run
  from missing evidence. Leave formatting to the configured linters, and avoid
  duplicate or speculative findings. A review request does not authorize implementation.
- Keep current PR defects in the review. Track confirmed pre-existing or explicitly
  deferred problems as issues when filing is authorized; comments-only reviewers
  provide a draft and state that it was not filed.

- Flag any path that accepts, stores, logs, or forwards a printed setup secret or
  a KM43 client key, or that treats account membership or a provider identity as
  permission on a controller.
- Flag cloud data or membership keyed only by `device_id`: history and access
  belong to an ownership generation, which a factory reset ends.
