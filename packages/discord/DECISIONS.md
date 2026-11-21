Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Discord as a skill
- Discord is a skill with one command, `discord send`, like the browser. OpenAgent knows
  no Discord. Picked over the dashboard's own poster, with its watchers, its settings and
  its stored credentials.
- It posts what it is given and decides nothing: when to post is whoever calls it, the
  person's command of the notifications-command plugin or an agent asked to. Picked over a
  skill that watches runs.
- The webhook is set per machine by a person (`discord setup <webhook>`), outside the
  project; `DISCORD_WEBHOOK` in the environment wins. Picked over a file in the project:
  anyone holding the URL can post to the channel.
- The skill calls the command by its full name and a version range,
  `npx @openagt/discord@0.1`: the name is ours on npm, so no other package can run
  under it, and nothing is installed in the project. Picked over `npx discord` with the
  package as a dependency of the project, which ran whatever package holds that name on
  npm where the install was missing, and which a project without Node could not have.
