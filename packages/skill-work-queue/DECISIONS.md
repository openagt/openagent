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
- A runner fires a command by its name, `/work-queue`; the agent's harness expands the
  skill. The command's words are the rules of the job — one task, commit, publish as far
  as whoever started the run said; the pull request naming the ticket it closes, then
  mark done, the `PR:` line and the release are the ticketing system's own rule for queued
  work — never a skill's name or command. Picked over the run that started the agent
  publishing for it: the agent pushes through the branches skill and opens the pull
  request through the git host's skill, both already in its checkout. Picked over marking
  done before the publish: a publish that failed lost the task. Picked over closing the
  ticket at commit time: a pull request closed unmerged lost the ticket.
- A ticket with nothing to do until something outside the work happens gets a `Waiting:`
  line, and its entry is marked done; the agent never closes it. Picked over closing the
  ticket to stop it coming back.
- The agent takes the first open entry and claims its ticket first; an entry whose ticket
  someone else holds is left for them, and the agent takes the next one. Picked over
  stopping at a held claim.
- The schedule starts `work-queue` only while an entry names no claimed ticket. Picked
  over a run on every tick that finds every entry held and stops.
- A task whose whole work is changing other tickets closes its own ticket; a plan leaves
  its ticket open. Picked over leaving every ticket without a pull request open: a
  finished ticket left open is queued again.
