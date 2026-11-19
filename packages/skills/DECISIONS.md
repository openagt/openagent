Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The two kinds of skills
- A skill is a module's or the project's own (#2394, decision 23). A module's skills reach
  OpenAgent's runs while the module is on, and are never written into a project. They stay
  skills, since an agent reads only a skill's name and description until it needs the rest.
  The project's own are committed in it, or added with `npx skills add`. OpenAgent lists them
  as commands and lets a run leave some out. It never installs or updates them. Picked over
  OpenAgent writing its skills' texts into each project that picked them, which put files in
  the person's repository and a commit to keep up to date.
- A project's own skill takes a default's place by having its name: the project's
  `.claude/skills/<name>` or `.agents/skills/<name>`, committed on the branch an agent
  starts from. Picked over a skill saying which default it does in a line of its own, a
  format nothing needs yet.
- OpenAgent has no command of its own to give a project skills: `npx skills add
  openagt/openagent` in a terminal writes the texts for any agent. Picked over
  `npx @openagt/init`, a second list with ticks to keep in step with the dashboard's.

## The Skills page
- The Skills page installs nothing (#2394, decision 24): Settings › Skills lists each
  project's own skills. Picked over a page of ticks that wrote the skills' texts into the
  project, committed them and pushed them.

## A project's commands
- While a skill is not yet on the branch agents start from, the launcher does not take its
  command, so it never offers a command the agent does not have. Picked over offering every
  command the project's folder has.
