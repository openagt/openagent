Topics: system-prompt, gates
Issue: [#1416](https://github.com/openagt/openagent/issues/1416)

# New gate: let agent gauge uncertainty

## TLDR

A gate where the agent gauges its own uncertainty and decides whether a person is needed. Example: CI is red, the agent fixes it; if the agent is confident, auto-merge; otherwise ask the user to choose between options and/or review.

## Why it matters

Confident, low-risk fixes land without waiting on a person, while uncertain ones still get human judgment.
