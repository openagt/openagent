Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The front door
- `npx @openagt/init` is the one front door: it gives a project its skills, and ends by
  asking "Open the dashboard?". "Add project" in the dashboard stays small and offers
  the same list with a button, so a person can use either. Picked over "Add project"
  writing the skills itself, which put files into every project a person adds, also one
  they only wanted to try, and over the dashboard only pointing to the terminal.
- A project has a skill when the skill's text is in the project: one tracked file,
  `.agents/skills/<name>/SKILL.md`, where Codex reads it, and one tracked link at
  `.claude/skills/<name>`, where Claude Code reads it. Init writes nothing else: no
  `package.json`, no install, so a Node project, a PHP project and an empty folder get
  exactly the same. Picked over files hidden from git and linked into each checkout,
  which a teammate, another machine and a cloud agent would not have, and over
  installing the skills' packages into the project.
- The skills every run gets by default are not in the list: branches, and the ones
  `@openagt/start` names, come with every run, with nothing written in the project. The
  list holds the skills a project picks beyond them. Picked over branches alone coming
  that way, where a person who cannot change the default branch got agents that could not
  ask a question.

## The list
- In a terminal init shows the skills as a list with ticks, in groups. Everything is
  ticked except the skills that need a setup of their own (browser, discord). Picked
  over writing every skill unasked, and over writing only the basic ones.
- To add or remove a skill later, run init again: the ticks show what the project has
  now, a tick added writes a skill, a tick removed deletes it. `add` and `remove` by
  name do the same without the list, for scripts, and ask nothing. Picked over separate
  commands only, which need every skill's name known.
- The scheduler is one more skill in the list, ticked by default. Writing its text also
  writes its two lines into the project's hooks file, which is this machine's and outside
  git; deleting it takes them out and stops it. Its text is in the project, so an agent in
  a terminal can start the scheduler with no dashboard. Every automation starts switched
  off, so a ticked scheduler starts no agent by itself. Picked over a tick that wrote the
  lines alone, which left no way to the scheduler but the dashboard; over a skill every run
  gets by default, which an agent in a terminal does not get; and over a scheduler that
  comes with the dashboard for every project.

## The commit
- After writing, init asks "Commit these files now?". On a yes it makes one commit on
  the branch the person is on, holding the skill files it wrote or deleted and nothing
  else they have open. It never pushes. Picked over leaving the commit to the person
  with a line of advice, and over committing and pushing unasked.

## A newer text
- When a skill in the project has a newer text, the person is told, and it is written
  only on their word. Picked over saying nothing until asked, and over every run of init
  writing every text again, which wrote over a text changed by hand.
