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
- The skill is picked on a project's Skills page, like any other. Runs switch accounts
  without it: the runner uses this package itself. The skill only lets an agent add or
  remove an account when the person asks. Picked over every run getting it, one more
  description in every agent's context for something a person seldom asks.
- An Accounts card built only on the command, the first skill whose card shows what its command
  says. Picked over moving the whole Settings page first; that it overlaps the Usage card is
  accepted, and Customize hides either.
- The person's own login can be logged out from the card and Settings, their terminal with it.
  Picked over never offering it: an account on the list cannot be added a second time, so there
  has to be a way to take any row off.
- The card says the same numbers as the Permissions page, and the skill reads them itself, with the
  `usage` command. Picked over the card showing only what the last run saved, which on one account
  is nothing, and over OpenAgent handing the card its own reading, which a skill's own page does
  not have.
- The card is "Coding agent accounts", and what it does at an account's limit is said behind an ⓘ
  beside its title, only while an agent has two accounts or more: with one each, nothing
  rotates. Rotation is the runner's for every run, ticked as a skill or not: the skill only
  teaches an agent to change the accounts when asked.
- Under each account's row the card draws the line the page it is on gives it
  (`accountWhere`), the account named by its agent, whether it is the own login, and its name:
  the Permissions page says there where the account works, on the person's servers. Picked over
  the skill reading the dashboard's servers, which it would then depend on.
- One way to add an account, the same for an agent, a card and Settings, here and on a server: the
  sign-in runs in a process of its own, and commands start it, read it and hand it the code. Picked
  over the sign-in staying in OpenAgent's process, where only Settings could reach it, and over
  refusing to add on a server.
- The card adds an account from "Add" at its title, a menu of the coding agents, and the sign-in
  is a dialog: whose account it is, then the sign-in followed there until the account is in the
  list, which closes it; closing it stops the sign-in. A card with no account at all also says so
  in its body, with a press for each agent. Picked over the sign-in unfolding inside the card
  under a row of agent names that read as a label.
- On a server `remove` is refused and says where to do it: the page keeps its own record of logins
  copied from a computer.

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
