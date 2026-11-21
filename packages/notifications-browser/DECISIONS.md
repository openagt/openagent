Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Telling the person in the browser
- Desktop notifications while the dashboard is open are a plugin (#2394: notifications are
  plugins, the browser, a command, Discord). Picked over the dashboard's own notifier and its
  Settings entry.
- What waits on the person (the Human Queue: a question to answer, a pull request to review)
  is told until they switch it off; plain activity (an agent starts or finishes) only once they
  switch it on (#627). Picked over both starting off, as the dashboard's other switches do: the
  Human Queue is how OpenAgent reaches the person.
