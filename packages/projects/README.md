# @openagt/projects

OpenAgent's projects, a core module of this computer's (#2394): the list of projects, and what
adds a repo to it and takes one off.

- **The list** is this computer's setting `projects.list` (`PROJECTS`, in `@openagt/hooks`'
  catalog). Only this module writes it; the shell reads it for its sidebar, its routes and every
  read that finds a project's folder by its id.
- **Adding a project**: by its folder (Add project, the system's folder dialog first), by its
  repository's address (cloned into `~/projects/<name>` as the account a module gives its host,
  `account.access`), or from the folder `openagent` was typed in (`app.lifecycle`'s
  `folderGiven`). Each asks whether you trust the repository first. The other modules are told
  of a project added (`projectAdded`).
- **The project picker**, in the row above the launcher's box (`composer.control` at `start`):
  no project, the projects, the repos every module offers (`composer.where`), this computer's
  among them (the folders under your home folder and the ones added), and an address typed in
  the search, to clone. **Settings › Repos** holds the folders searched.
- **Remove project…**, in a project's menu (`project.menu`): off the list, and with the box
  ticked OpenAgent's files in its folder too. Every module cleans up its own
  (`app.lifecycle`'s `projectRemoved`) and says what it removed and kept; the dialog lists it.
  Refused while a module says no (`app.lifecycle`'s `refuseRemoval`): agent-driver's, while a
  run's process is alive there.
- **Add your first project**, the Overview's first step while the list is empty (`app.attention`),
  and **Not activated** on a listed project whose folder lost the `.openagent/.gitignore` adding
  it writes.
- A run's steps: its project's repository is there (`RunOrder.CLONE`), and the agent is told
  where the copies of the repos its task is about are (`RunOrder.CONTEXT`).

What other modules import of it (`@openagt/projects`): making a folder a project
(`installProject`, the `.openagent/` ignore file), the id a project's folder gets on the list
(`projectId`), the repositories the person owns (the repo owners, in the person's own folder), and
a module's own directory at a project's root taken away again (`removeOwnDirectory`).
