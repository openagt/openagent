Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The profile
- The person's name and picture are their own in OpenAgent (Settings › Profile), kept in their
  own folder so every computer of theirs shows the same.
  "Sync from GitHub" copies a GitHub profile's name and picture once, read with no login; no git
  host is asked after. With none set, the name is git's and there is no picture. Picked over
  the name being git's and the picture the git host's, read live (Rom: decoupled from GitHub).
