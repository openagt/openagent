Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Commands
- Two kinds of skill: capability skills (`branches`, `tickets`, `queue`, `logs`, `github`),
  each a SKILL.md and a command, each saying how to do one thing; and command skills, each
  a SKILL.md only, each a job that composes capabilities. A command assumes no capability
  and names no skill; where the job is broken without a capability, it says so in
  capability words and stops. The check of its `schedule`, in the front matter, is the one
  place that names commands: the scheduler runs it and the agent is never given it. Picked
  over a command naming the capabilities it uses, which would tie the job to a package. A
  capability never names another skill.
- One package per command, `@openagt/skill-<command>`, its SKILL.md in `skills/<command>/`
  like the capability skills. Picked over one package holding every command, so a project
  installs the commands it wants and nothing else; the name follows Claude Code's own
  convention, a command is a skill.
- A command is marked `disable-model-invocation`: a person or a runner fires it, the agent
  never picks it on its own.
- A runner fires a command by its name, `/update-tickets`; the agent's harness expands the
  skill. The command's words are the rules of the job — note the time before fetching and
  record it after, so nothing edited meanwhile is missed; only what changed since the last
  import; one ticket per issue, updated in place, closed when the issue is; the tickets
  named by the pull requests merged since the last import closed too, which is how a
  ticket closes at its merge; an error in capability words when the tracker cannot be
  reached, or tickets exist with no last-import time — never a skill's name or command; no
  import time recorded when anything fails, so the next run fetches the same changes
  again.
- The project's schedule starts `update-tickets` only when an issue changed since the last
  import, or a pull request merged since then has a line `Closes tickets/` followed by a
  file name, or when no import time is recorded and there are no tickets: a first import.
  Picked over starting it on any merged pull request, which ran the job about
  forty times a week to change nothing.
- An open issue with no ticket gets one only when it was opened or reopened since the last
  import. Picked over giving one to every changed open issue with no ticket, which brings
  back a ticket closed on purpose and makes one for every old issue a comment or a bot
  touches.
