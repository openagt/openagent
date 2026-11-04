Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Asking the person
- A skill teaches the agent the `await-choices` block: `ask`, one SKILL.md the agent
  picks by itself when a choice is the person's. Picked over the runner adding a line to
  every prompt (prompt text of the runner's own) and over a system prompt through the
  driver (Codex has none, and a hidden prompt comes back).
- The skill is named `ask`, a verb for what the agent is about to do: named `question`,
  Sonnet answered with the question in plain words and never loaded it. Picked over
  `ask-user-question` (Claude Code's own tool's name) and `ask-the-person`.
- The skill's description says when to use it, every time the agent is about to ask, not
  what it teaches, and says it is required: Codex's gpt-6-luna skipped a skill described as
  how to ask. Picked over a line about asking in the agent's prompt, in the project's
  CLAUDE.md and AGENTS.md, or under the person's prompt.
- The skill names the two fence lines of the block: Codex's luna models wrote the JSON
  without them, and it showed as raw text.
- Nothing is written before the block, not the question and not the choices: the card
  shows both, and what the person needs to know to decide is in an option's detail, as
  every option has one. Picked over a few lines above the block, which repeated the card.
- The block has a `header`, the question in a word or two ("Background"): a question the
  person passed by with a message is one line named by it, `Asked "Background"  Replied in
  chat`. Picked over naming it by the whole question, or by the same words every time.
- An agent that has a tool of its own for asking the person uses it; the block is for an
  agent with none, as one a runner starts without a terminal. Picked over a mark the
  runner puts in the agent's environment: runner code, and a skill naming a runner. It is
  said last: said first, Codex's gpt-6-luna took it for its own message tool and asked in
  plain words. It points the agent at its own tool list and names no tool or agent:
  naming Claude Code's AskUserQuestion sent Sonnet searching for it, and naming Claude
  Code in a terminal made Sonnet, which is Claude Code, ask in plain words.
