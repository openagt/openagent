Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The distribution
- OpenAgent ships as this package: the modules it runs, listed in one file, and `openagent`,
  `@openagt/ui`'s command serving them (#2394). `ui` is the shell, and runs no module of its own.
  Picked over one package holding the shell and every feature, where a module could not be
  added or left out without changing the shell.
