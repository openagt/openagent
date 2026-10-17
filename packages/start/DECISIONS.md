Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The package
- OpenAgent is run as this package: the dashboard, with the skills every run gets by
  default. The list of those skills is here, and only here: the dashboard is the server,
  with no command of its own, and the runner links the skills it is handed. Picked over
  the list staying in the runner, with this package only a name for the dashboard's
  command, where the dashboard alone was already OpenAgent with its skills; and over
  renaming the dashboard, where a plugin would import its API from a package named for a
  command.
- A project's own skill takes a default's place by having its name: the project's
  `.claude/skills/<name>` or `.agents/skills/<name>`, committed on the branch an agent
  starts from. Picked over a skill saying which default it does in a line of its own, a
  format nothing needs yet.
