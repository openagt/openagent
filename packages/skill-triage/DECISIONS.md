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
- One triage command with a mode word, `/triage quick` and `/triage consensual`, and both
  modes when the word is missing; each mode is a scheduled command of its own, with its own
  pace and its own switch. Picked over two commands one sentence apart (the same job
  written twice), and over one scheduled command running both modes (significant work would
  then be queued wherever quick wins are, with no switch of its own).
- The command's words are the rules of the job, in numbers two runs agree on, read off the
  ticket listing: a quick win is a planned ticket with effort 2 or less and uncertainty 2
  or less; consensual work is a planned ticket with uncertainty 3 or less that is no quick
  win; a plan without both numbers qualifies for nothing; a ticket on the queue, held, in
  review, waiting or whose plan is outdated is skipped; every pick goes on the queue at
  the ticket's priority, lowest effort first; only queue, never do, so a human can still
  veto on the queue. Picked over "low effort and no uncertainty" and "significant,
  consensual", which one run read as uncertainty 0 (never met) and another as uncertainty
  3; over bumping quick wins one above their priority, which contradicted the rule every
  ticket is queued by; and over skipping a ticket whose plan records a decision not to do
  the work, which no plan key marks and two runs read differently (such a ticket is closed
  by hand).
