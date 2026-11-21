Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Diagrams
- A mermaid block is drawn as its diagram by a plugin of its own, which starts off: the
  library is heavy, so it is opt-in (#2394). Picked over the markdown renderer drawing
  diagrams for everyone.
