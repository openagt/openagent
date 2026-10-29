Topics: accounts, skills
Issue: [#2242](https://github.com/openagt/openagent/issues/2242)

# Account rotation as a skill: `@openagt/skill-accounts`

## TLDR

Account rotation is built into the runner (`agent-driver/core/src/accounts.ts`) and only works for runs OA starts. Move it into a skill package built like `skill-scheduler`:

- An `accounts` command: `add`, `list`, `remove`, `use-first`, plus `next` and `limited` for the runner.
- A SKILL.md, so an agent can add or list accounts when the person asks ("add my second Claude account").
- The Accounts settings move into the package's own dashboard part.
- The runner calls the package instead of having rotation built in.
- `accounts run claude`: the person's own terminal `claude` on the next free account; when it hits its limit, it continues on the next one with `--resume`. No OA install needed.

To check first: can a wrapper catch the limit in Claude Code's interactive screen? (Easy in `-p` / stream-json.)

## Why it matters

Asked for in #2239: people want account rotation on a project without installing OA there. As a standalone skill it works for anyone's own `claude`, and the runner gets simpler.
