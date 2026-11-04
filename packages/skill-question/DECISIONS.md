Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Asking the person
- A skill teaches the agent the `await-choices` block: `question`, one SKILL.md the agent
  picks by itself when a choice is the person's. Picked over the runner adding a line to
  every prompt (prompt text of the runner's own) and over a system prompt through the
  driver (Codex has none, and a hidden prompt comes back).
- The skill's description says when to use it, every time the agent is about to ask, not
  what it teaches: Sonnet took a description of how to ask for one it did not need and
  asked in plain words. Picked over a line about asking in the agent's prompt.
- An agent that has a tool of its own for asking the person uses it; the block is for an
  agent with none, as one a runner starts without a terminal. Picked over a mark the
  runner puts in the agent's environment: runner code, and a skill naming a runner.
