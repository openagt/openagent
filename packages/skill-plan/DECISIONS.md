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
  SKILL.md only, each a job that composes capabilities. A command assumes no capability
  and names no skill; where the job is broken without a capability, it says so in
  capability words and stops. Picked over a command naming the capabilities it uses,
  which would tie the job to a package. A capability never names another skill.
- One package per command, `@openagt/skill-<command>`, its SKILL.md in `skills/<command>/`
  like the capability skills. Picked over one package holding every command, so a project
  installs the commands it wants and nothing else; the name follows Claude Code's own
  convention, a command is a skill.
- A command is marked `disable-model-invocation`: a person or a runner fires it, the
  agent never picks it on its own.
- The plan command ends on the ticket and its plan, the ways to do the work and the one
  it recommends; a person reads the plan and queues the ticket. Picked over the agent
  queuing or working its own ticket, and over the alternatives the old system prompt had
  every agent show before every change: the options are weighed once, in the plan.
