Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Orchestration as a skill
- A main agent runs subagents through a skill with a thin command of its own,
  `orchestration` (`start`, `list`, `read`, `stop`), in a package that depends on the
  runner. Picked over more commands on `agent-runner` (the runner would grow commands
  only a skill uses) and over a skill file alone (listing and stopping need the runner's
  mark and a pid, which no command prints to an agent).
- The words are main agent and subagent. Picked over coordinator and worker.
- The package and its command are named `orchestration`. Picked over `subagents` and
  `agents`.
- The skill calls the command by its full name and a version range,
  `npx @openagt/skill-orchestration@0.1`: the name is ours on npm, so no other package
  can run under it, and nothing is installed in the project. Picked over
  `npx orchestration` with the package as a dependency of the project, which ran
  whatever package holds that name on npm where the install was missing, and which a
  project without Node could not have.

## A subagent
- A subagent's branch starts from the main agent's branch, not from origin's default
  branch: it works on what the main agent already committed.
- A subagent starts no subagents. Picked over a tree of any depth.
- What every subagent must be told (commit to its branch, publish nothing, ask
  nobody) is added to its task by the command. Picked over the skill file asking the
  main agent to write it into every task: a rule that lives only as prose is forgotten.
- A subagent's coding agent and model come from the person's settings, by how hard its
  task is: the plan says simple or hard per task, and the setting for that level
  names the coding agent and model. The main agent never names a model. A level nobody set
  runs on the main agent's own coding agent and model. Picked over the main agent choosing a
  model per task, which spends the person's money on the agent's guess, and over the coding
  agent's own default, which may not be the model the person runs on.
- `start` is refused for a task whose plan entry says no level. Picked over a missing level
  meaning simple or hard: either is a silent guess, and a rule that lives only as prose is
  forgotten.
- At most as many of a main agent's subagents run at once as the person's setting says, 4
  when unset; `start` is refused past it, and the main agent starts the next when it is told
  one ended. Picked over the command waiting for a free place, which keeps a process waiting,
  and over one limit for the whole machine.
- The settings are this machine's, in a file the orchestration package keeps at the
  project's root, hidden from git, written by `orchestration settings`. Picked over the
  dashboard's own settings file, which a skill would have to know, and over the tracked
  repository, where one person's models would be everyone's.
- The settings are one section of the Settings page, the same on every project: a coding
  agent and model for simple tasks and for hard tasks, and how many run at once. The section
  saves them to every project that has the package. Picked over a setting per project.

## The plan and the person's yes
- The plan is one markdown file beside the main agent's run record on the data branch,
  saved with `plan <file>`. Picked over a ticket file per task: tiny tasks would flood the
  tickets, and one file is read in one go when approving.
- The plan is a task list the command reads, not prose it only keeps and hashes: the prose above
  the first task is the shared context, and each `## ` heading is one task, its name, with
  `Level:`, `Files:`, `Needs:`, `Check:` and `Uncertainty:` under it. Picked over the main agent
  writing each subagent's prompt itself, which retyped the same preamble into every task and left
  a subagent's row to be the first line of that prompt.
- A subagent's words come from one task of the plan the person approved: `start --task <id>`, and
  the command builds the prompt. Picked over a task quoted on the command line, which spends the
  person's money on words they never read.
- The task's heading is the name on the subagent's record. Picked over naming a subagent the way a
  run is named, by asking a small model: the plan already holds the name.
- Only a task whose `Uncertainty:` is 0 may be a subagent, and one that names no uncertainty is
  refused as well. Picked over the main agent judging it task by task: a subagent is told nobody
  will answer it, so a task holding real alternatives is the main agent's own.
- The two plan formats stay apart: orchestration borrows `Uncertainty:` from the ticket plan format
  and names no other skill. Picked over one skill owning the format and the other pointing at it,
  which `skill-plan/DECISIONS.md` forbids: "A capability never names another skill".
- No subagent starts before the person approved the plan: `start` is refused until the
  main agent's log holds their Approve to a question that names the plan as it is saved,
  so a changed plan needs a new yes. Picked over the skill file telling the agent to ask
  first: nothing stops an agent that skips it, and a start spends money.

## Landing
- A subagent's work reaches the main agent's branch through `land`: a plain merge, then
  the subagent's branch is deleted. Picked over a squash per task, and over the skill file
  telling the agent to merge and delete by hand: a rule that lives only as prose is
  forgotten, and a branch would stay behind for every task.
- `land` keeps the subagent's last commit, under `refs/landed/<run id>` on this machine,
  and on its record. Picked over the commit id alone: git drops the commit once the main
  agent's branch is squashed and deleted. Picked over saving the list of changed files:
  the counts would stay and the diffs would go. Pushing the ref to origin was the earlier
  rule and was dropped: nothing leaves the machine without the person's word.
- The plan ends as one pull request, of the main agent's branch, opened like any run's: by
  the person's click or ask, and not before every task is landed. The main agent opening
  it by itself was the earlier rule and was dropped: approving a plan is a yes to starting
  subagents, not to publishing.
