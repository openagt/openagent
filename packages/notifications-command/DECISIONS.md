Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## When a run needs a person
- When a run ends waiting on a question, or ends done with a pull request it did not have,
  a command the person wrote runs, with one line for a person in `MESSAGE`. OpenAgent names
  no service; what the command does is the person's. Picked over the agent posting (it can
  forget, and a dead run posts nothing) and over the dashboard watching the runs (nothing
  posts while no dashboard is open).
- It is a plugin, run at the run's last step (#2394: notifications are plugins, the browser,
  a command, Discord). Picked over the runner running a line of its own config
  (`ended:` in `.agent-runner/config.yml`).
- The command is per machine. Picked over one in a committed file: where to post is set per
  machine, and a teammate's machine should not post to your channel.
- A question and a new pull request only. A run that fails, is stopped, or ends done with
  nothing to review runs no command. Picked over a command on every end: the command is for
  what waits on a person.
