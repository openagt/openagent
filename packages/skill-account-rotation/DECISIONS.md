Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The tool
- A skill package of its own, named `skill-account-rotation`. `skill-accounts` is kept for
  logged-in user accounts of other kinds. Picked over rotation living in the driver core,
  where nobody could use, read or replace it apart from the drivers.
- A driver holds no rotation: it is handed one (`AccountRotation` in `agent-driver`) by
  whoever starts it, and a driver handed none runs on whatever login its agent has. The
  package depends on the drivers for their logins, never the other way. Picked over the
  drivers calling this package, a circle of packages, and over the switching staying in
  the drivers, with only the list moved out.
- Every run gets the skill: accounts are the computer's, so no project ticks it.
- An Accounts card built only on the command and `@openagt/skill-ui`, the first skill that shows
  the same on OpenAgent's Overview and on its own page. Adding and removing stay in Settings ›
  Accounts for now. Picked over moving the whole Settings page first; that it overlaps the Usage
  card is accepted, and Customize hides either.
- On a server `add` and `remove` are refused and say where to do it: a server's sign-in needs
  the page's paste step, and the page keeps its own record of logins copied from a computer.

## Accounts
- A person may give an agent several accounts of its own, kept in a list in their order: a
  run is on the first one free, and one that hits its limit hands the same conversation to
  the next free one, which is told to go on where it stopped. Only the runs an agent's
  driver starts change account: the account's login reaches that turn alone, and the
  person's own login, the one their terminal uses, is never touched. How it reaches the turn
  is the agent's own (Claude Code reads a login from the turn's environment; Codex keeps one
  in its home folder, so an added account has a folder of its own that links to the
  conversations of the person's home); the list, its order and the hand-over are one piece
  every agent shares. Picked over
  switching the whole computer's login when a limit is hit (every session moves, the
  person's terminal included, and a Mac keeps its login where such a switch cannot reach),
  and over a pooled account that people lend to an agent through a link (later, maybe).
- An account hands over only to an account of the same agent: a conversation is kept in
  each agent's own format, so moving it to another agent would lose it.
