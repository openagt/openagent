Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Where a run runs
- A run in a Claude Code cloud session on claude.ai is a host's (`run.host`), in a plugin of
  its own, with the Chrome extension that makes its sessions and carries their questions and
  answers (#2394). Picked over the session staying in the product beside the run engine, and
  over one `web` package for both vendors' clouds: a `codex-web` would share nothing with it.
- Its Enabled row is the only switch, and it starts off (#2394). Picked over a switch of the
  bridge's own among the dashboard's settings.

## What follows a run
- The pass that follows a run after its hand-off (its session's branch and pull request, its
  end, its start's branch on origin) is the plugin's own timer, started and stopped with it
  (`app.lifecycle`, #2394). Picked over a clock of the daemon's shared by every background job.
- A session parked on its person is said through `app.attention`, as everything that waits on
  the person is (#2394). Picked over the shell reading the bridge's questions itself.
