Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Commands
- Two kinds of skill: capability skills (`branches`, `tickets`, `queue`, `logs`), each a
  SKILL.md and a command, each saying how to do one thing; and command skills, each a
  SKILL.md only, each a job that composes capabilities. A command assumes no capability and
  names no skill; where the job is broken without a capability, it says so in capability
  words and stops. The check of its `schedule`, in the front matter, is the one place that
  names commands: the scheduler runs it and the agent is never given it. Picked over a
  command naming the capabilities it uses, which would tie the job to a package. A
  capability never names another skill.
- One package per command, `@openagt/skill-<command>`, its SKILL.md in `skills/<command>/`
  like the capability skills. Picked over one package holding every command, so a project
  installs the commands it wants and nothing else; the name follows Claude Code's own
  convention, a command is a skill.
- A command is marked `disable-model-invocation`: a person or a runner fires it, the
  agent never picks it on its own.
- A runner fires a command by its name, `/plan-tickets`; the agent's harness expands the
  skill. The command's words are the rules of the job, in numbers read off the ticket
  listing — a ticket needs a plan when it has none or an outdated one, and is neither held
  nor in review nor waiting nor on the queue; at most ten a run, highest priority first,
  then oldest; one entry per ticket, `Create tickets/<name>.plan.md`, at the ticket's own
  priority; no plan written by this agent — never a skill's name or command. Picked over
  the agent ranking the tickets and picking each priority after reading them, which two
  runs never did the same way; and over one agent per ticket with a claim: the queue is
  the fan-out, and the queued work writes each plan one at a time.
