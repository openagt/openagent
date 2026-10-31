Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## UI for skills
- A skill gives useful UI of its own. Used outside OpenAgent, the UI runs on a page of its
  own; inside OpenAgent, the same UI is put in the dashboard's slots. Picked over a skill's UI
  that only runs inside OpenAgent, as every `./dashboard` export did.
- The name is `@openagt/skill-ui`, and it is meant to replace the dashboard, one piece at a
  time: pieces move from `@openagt/dashboard/module` to this contract until nothing is left.
  Picked over moving the whole dashboard at once, and over a contract that stays beside it.
