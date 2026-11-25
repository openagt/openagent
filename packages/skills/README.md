# @openagt/skills

The skills module of OpenAgent: which skills a run gets, and a project's own skills.

What it brings:

- **A run's skills, linked where its coding agent works** (`./module`, the run's `SKILLS` step): the
  ones the run's modules give it (`run.skills`), every core module's and those of the plugins on in the
  project that the run does not go without, beside the project's own skills it keeps.
- **The Skills line** of the gear's menu under the message box, after the profile's
  (`composer.control` at `setup`): the plugins on in the project, each ticked, tickable off (the run
  goes without it, none of its skills nor its steps), and which of the project's own skills the run
  keeps, all, none or each. It writes the run's `plugins.without` and `skills.project`, and counts what
  the run gets on the profile in force: the one the options name, else the one picked for every next
  run, else Default. In a session it says the run's picks; in a profile's editor it edits the
  profile's own.
- **The project's commands** in the message box's `/` menu and Commands menu (`composer.commands`):
  its own skills written to be run by a person, each said waiting while it is not on the branch runs
  start from.
- **Settings › Skills**: each project's own skills, listed. It installs nothing.

What the dashboard reads is its server part's (`./server`).
