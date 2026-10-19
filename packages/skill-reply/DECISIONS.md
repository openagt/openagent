Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The command
- The agent that opened a pull request answers what came on it, on the coding agent and
  model it ran on: the scheduler resumes that run, and this command is what it is told.
  Picked over a new agent for each comment, which knew nothing of the work.
- Its own package, a skill file only: its front matter is the scheduler's row. Picked over
  a row in the GitHub skill, whose skill is the agent's guide to GitHub, not a command.
- Only maintainers' comments count: people who can write to the repository. An agent
  posts with a person's account, so what it posts carries the 🤖 line, and is never
  counted.
- Red checks and conflicts with the base branch wake the agent too. A conflict is
  resolved by merging the base branch in, never by a rebase or a forced push; one it
  cannot resolve with confidence is said on the pull request for a person.
- A pull request opened before the project had this command is not answered: its run's
  checkout does not hold the command. Picked over sending the command's text in its place,
  and over every run carrying the command.
- A pull request with no run behind it: nothing happens.
