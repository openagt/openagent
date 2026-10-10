Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The dashboard
- A projection of files: it shows a project's runs by reading what the runs write, and it
  runs no agent of its own. Picked over the dashboard owning the agent it shows, which is
  what made every capability a person wanted — another coding agent, a schedule, a run on
  another machine — a feature of OpenAgent.
- It ships no prompt text. What a project can be asked to do is what the project's own
  skills say. Picked over the built-in presets: a prompt that lives here cannot be read,
  changed or run by the agent working the repository.
- The tickets are a package's: OpenAgent reads them through the command the package
  declares (`openagent.tickets`, `list --local`), and only for what it composes across
  skills, the onboarding step, a queued link's title. Showing,
  planning, claiming and releasing a ticket is the package's own module, through its
  command. Picked over the dashboard's own ticket pages fed by the provider, which would
  have kept a reserved route and a hand-written sidebar row.
- The checkouts are a package's: OpenAgent finds a run's checkout, and pushes and
  reclaims its branch, through the command the package declares (`openagent.branches`:
  `list`, `show`, `push --branch`, `remove`); it composes a pull request's title and body
  from the run, and keeps the rule that says which pull request is a run's. Picked over
  OpenAgent's own git handoff, which was a second way to publish.
- The git host is a package's: every pull request OpenAgent opens, lands or reads goes
  through the command the package declares (`openagent.git-host`: `requests`, `open`,
  `merge`, `home`), and Open PR is the two commands composed, the push then the open.
  OpenAgent names no git host and runs no git host tool; a project with no git host package
  has no pull requests, and a finished run's last step is Push. Picked over the branches
  package opening the request, which put the git host inside the git skill, and over a git host
  adapter inside it, which made another git host a change to that package.
- An agent that ended with its work uncommitted gets a "Commit" button on its page, beside
  the files it left. The button asks the agent to commit: it sends it "Commit your work."
  The dashboard commits nothing itself, since the agent knows what it changed and writes the
  message. Picked over a message that only names the files and leaves the person to type
  the ask. From the press until the agent's turn ends, the ask shows in the chat and the
  button's place reads "Committing…". Picked over a button that only greys out: the page
  said nothing of what the agent was doing for the seconds it takes to start again.
- A project with no remote is offered one step on a finished agent's page: "Merge",
  which merges the agent's branch into the project's default branch on this machine,
  through the branches provider. A conflict changes nothing and is said. The merged branch
  is deleted once no checkout holds it, and the run's record then keeps its last commit and
  where its work began, so the page still shows what the agent changed. Picked over "No remote to push to", which left
  the work on a branch the person could only reach from a terminal.
- A project with no remote is offered "Create a repository on <host>…" in its project menu,
  when a package can create one: private, under the person's account, named after the folder,
  pushed. It asks once before it does it, naming the repository, since the project's code
  leaves the machine. Which host is the package's business. Picked over a field to paste a
  repository address into, which leaves creating the repository to the person.
- A subagent's page offers no pull request, no merge and no push. It says landed or not
  landed. Picked over saying nothing in their place.
- Which package provides a kind of data when several installed packages declare it: the
  project's own package.json says, under the same `openagent` key with the package's name
  as the value; several and no line means nothing provides it, and the project's banner
  says why. Picked over the first in dependency order, taken silently, and over routing by
  the remote's host.
- An Overview card belongs to the package whose data it shows: a module declares its cards
  and OpenAgent draws them, in the order the cards name, only where a project has the
  package. Picked over OpenAgent's own cards fed by the providers, which showed an empty
  queue to a project with no queue package. The onboarding steps stay OpenAgent's.
- The Overview's queue card is the queue package's and its hot-tickets card the tickets
  package's, each reading through its own command; OpenAgent draws neither, reads no
  hot tickets and rules no lane. The lane for queued tickets was OpenAgent knowing both
  packages and is gone: a ticket's way onto the queue is the action the queue package
  offers on links, drawn beside the row where a project has that package.
- A run is named by its intent, else the name the branches package answers for its branch,
  else the branch as the agent named it; OpenAgent derives no session name from a branch.
  Picked over stripping the package's prefix here, which was OpenAgent knowing how the
  package names a branch.
- Notifications are the browser's only: the bell alerts in the open tab. Posting to a
  channel is a skill's, fired by the tool that runs the agent when a run ends. Picked over
  the dashboard's Discord watchers, which posted only while the dashboard was running.
- The dashboard grows by modules: a package that adds to the dashboard (pages, Overview
  cards, link actions, side-rail tabs, a run's summary, Settings sections) is a module;
  a skill that brings pages is a module that is also a skill. A module is one OpenAgent
  brings itself, or a package among a project's dependencies, whoever wrote it. The
  Files tab is the first module that is no skill. Picked over keeping Files a folder
  inside OpenAgent, which gave it a boundary but taught the module contract nothing, and
  named module over widget.
- The packages every project wants are built in: OpenAgent depends on them and uses them
  for every project through the same contract as any package (a module by its
  `./dashboard` export, a provider of a kind of data and the writer of its hook lines by
  its `openagent` key). They are Files, the runner, the packages that read a project's
  runs and checkouts, and the GitHub package, so an empty folder starts an agent, shows
  it, and can be put on GitHub. A built-in git host is a project's only when the
  project's remote is on that host: it was not chosen by the project, so it does not
  answer for a project on another host. Picked over each project installing them itself,
  which left a project with nothing installed unable to start an agent or to see one.
- A project has a skill when the skill's text is in the project, where the coding agents
  read it (`.claude/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`).
  OpenAgent brings the packages of the skills that have pages itself (tickets, queue,
  orchestration) and gives each to the projects that hold its text, with its page, its
  cards and its data; deleting the skill's folder takes them away. The scheduler, a tool
  with no text, is a project's when one of the project's hook lines runs it. Picked over
  a project's pages coming from its own `package.json`, which needed an install in every
  project, and which a project without Node could not have.
- Two lists name the packages OpenAgent brings, the ones every project has and the ones
  a project picks, and nothing else in OpenAgent names a package. One of those names
  among a project's own dependencies is not read: OpenAgent's copy and its rule are the
  only ones. Picked over a project's own copy winning, which gave one package two ways
  into a project.
- "Add project" stays small: it writes no skill. The project's page then says how many
  skills it has ("This project has 4 of 25 skills"), with an "Add skills" button that
  opens the same list with ticks `npx @openagt/init` shows in a terminal, through that
  package's own code, so the two cannot drift apart. Picked over "Add project" writing
  the skills itself, which put files into every project a person adds, and over only
  pointing to the terminal.
- When a skill in a project has a newer text, the project's page says so in one line ("3
  skills have a newer text") with an "Update" button; the texts are written only on that
  press, and the person reads the change in git. Picked over saying nothing until asked,
  and over writing every text again unasked.
- After a change the dashboard offers the same commit init does: one commit of the skill
  files that change wrote or deleted, those alone, on the branch the folder is on, never
  a push. While a skill's text is in the folder but not yet on the branch agents start
  from, the page says so ("tickets: waiting to reach main"), and the launcher does not
  take its command, so it never offers a command the agent does not have. Picked over
  leaving the commit to the person with a line of advice, and over committing and
  pushing unasked.
- A module may bring a section of the Settings page, shown after OpenAgent's own
  sections, where a project has its package. It reads and writes through the package's own
  command. Picked over OpenAgent's own sections knowing a package's file and a hook line
  per setting, which made every package's settings a change to OpenAgent.
- The scheduler is a package's: its Automations page, its Settings section and its Overview
  card are the scheduler package's own module, read and written through its command.
  OpenAgent reads no scheduler file and has no hook line for a scheduler setting. Picked
  over OpenAgent's own Automation section and scheduler card, which read the scheduler's
  state file by name and needed a hook line per setting.
- A module may put a stop line on the usage bar: where its unattended work stops, as an
  offset from the quota boundary. The bar draws it and its handle, and the module reads and
  saves the offset through its own command. With no such module the bar shows the account
  only. Picked over OpenAgent reading the scheduler's state file and writing through an
  `offset` hook line, and over dropping the handle, which lost dragging on the bar.
- A module may bring a server part (`./server`) that the daemon calls in its own process,
  given the project's folder and the facts about a run, never a verdict about them. Picked
  over reading only through the package's command, a new process for every read of a tree
  that polls every 8 seconds and a preview on every hover.
- A package OpenAgent brings to every project may bring a service: a command of its own
  that OpenAgent runs for as long as it runs itself, and tells its own address. Picked
  over a line in each project's hooks file, which is a project's and shared with its team,
  where a service is one computer's; and over running it inside OpenAgent's own process,
  where a fault in it is a fault in OpenAgent.
- The chat shows a `screen` line as the live page it names, on this machine's loopback
  only, and knows nothing of what the page is. Picked over a `browser` kind the dashboard
  renders itself, which the next package showing something would have had to repeat.

## Starting a run
- A Start runs the project's own `start` line, in the project's hooks file, and the line
  answers the new run's id. The daemon runs what the line says and calls no tool by name.
  Picked over the daemon calling the tool itself: the person picks what starts their runs,
  and a project that starts its runs some other way is not a special case.
- Adding a project has every package that writes hook lines write its own into the project's
  hooks file: the project's packages, then the built-in ones, the runner's `start`, `resume`
  and `check` among them. So a new project starts an agent with nothing typed by hand. The
  lines are a default: a line already there is kept, and the person can change or delete any
  of them. Picked over the launcher telling the person which command to run, which left an
  empty folder unable to start.
- A hook line finds its tools in the packages OpenAgent brings first, then in the
  project's installed packages. Nothing is downloaded to run a line. Picked over `npx`
  in the lines, which downloads whatever package holds the name on npm when the project
  has not installed it, and over the project's installed copy first, where a line ran
  one copy of a tool and the tool's page went through another.
- The line gets the prompt, and the coding agent, the model and how far to publish when the
  person picked them; anything else is the line's own business. The publish pick is one menu
  beside Start: Nothing, Commit, Publish branch, Open PR, Merge on green. It is saved like the
  coding agent. A project with no git host package
  is offered Nothing, Commit and Publish branch only. A project with no remote can publish
  nothing, so it is offered Nothing and Commit, and a saved pick it is not offered counts
  as Commit.
  Picked over handing over every option the launcher once had, which is how the options
  became the thing to maintain.
- Until a person picks in that menu, a run commits its work and pushes nothing. Picked over
  Publish branch until then, which put on the remote a branch nobody asked to publish.
- The line also gets the branch to start from, when the person picked their own local branch
  on the launcher's chip: the branch the project's folder is on, as this machine has it,
  commits that are not pushed included. With no pick the agent starts from the project's main
  branch, fetched first, as before. The pick is saved per project, and the agent's page says
  it. Picked over a pick saved once for every project: a branch belongs to one project.
- The chip is shown only where the pick is obeyed: the project's start line passes the branch
  on, the repository has a remote, the folder is on a branch, and the run is on this machine.
  Picked over a chip shown everywhere, which on a start line written before the pick existed
  would be a pick that silently does nothing. Picked over rewriting a person's start line.
- A branch name that could be read as an option on the line's command line refuses the Start.
  Picked over dropping it and starting from the main branch, which would be a silent swap.
- A project with no `start` line cannot start a run from the dashboard, and the launcher
  says so and names the file. Picked over a built-in fallback: the hooks file is the one
  place that says what starts a run.
- No cap on a person's runs: the click is the brake. Picked over the one-run-per-checkout
  guard, which existed because runs shared a working tree and they no longer do.

## Running on another machine
- The machines a person saved are kept in their home file, beside their projects and their
  settings, and a machine's key is never handed to a browser. Picked over the browser's own
  storage, where each browser had its own list and the daemon, which makes the calls, did
  not know the machines.
- A run sent to another machine names its project by the address its repository was cloned
  from, and starts in that machine's own copy of it. Picked over the folder's name, where
  two projects named alike are mixed up and a renamed folder breaks the link, and over
  linking the two folders by hand, a step for every project on every machine.
- A machine that does not have the project starts nothing, and the person is told which
  project to add there. Picked over starting in the folder that machine's OpenAgent was
  started in, which may be another project.
- A project with no repository address runs on this machine only, and "Run on" says so.
  Picked over sending the repository straight to the other machine, a second road for
  code beside the git host.
- On screen, a computer that runs agents is a machine. Device is kept for a phone or a
  browser that gets in. Picked over device for both.

## Saying something to a run
- What a person says reaches a run through what the run's tool reads: a line in the run's
  inbox file while the run works, the project's `resume` line once it has ended. Picked
  over a channel of ours that every tool would have to learn.
- A run that ends while the line is on its way has its line taken back out of the inbox
  and resumed instead. Picked over leaving it for a run that will never read it.
- An answer is checked against the question the run's diary holds open, and handed over as
  the option's label. Picked over passing the pick through: only what the agent offered
  can be answered, and the agent reads words, not ids.
- Stop is a signal to the process the run's card names, whoever runs it. Picked over a
  message to the run: a stop that has to be read is not a stop.

## A run's record
- One place: a run's card and diary in its own checkout while it works, and, once it has
  ended, what the project's runs provider answers. Picked over OpenAgent keeping a
  copy of its own, which is what made a run's history a question with two answers.
- A read never writes. A run whose process is gone is its tool's to sweep. Picked over the
  dashboard ending a run it did not start.
- A question stays open while the run waits on it, and closes when the agent goes on or
  the run ends for good. Picked over a run's end closing it, which left a waiting run's
  question on screen as text nobody could answer.
- A run that finished `done` on this machine and left no checkout, branch or pull request
  changed nothing, and its Files tab shows the project's files with nothing marked. Picked
  over saying its changes are gone, which read as lost work. No other run is judged so.

## Sweeping origin's scratch refs
- A branch on origin is a run's, and may be swept once landed, unclaimed by a pull request,
  old and idle, when a run's record names it, aged by that record. Picked over a naming
  pattern, `agent-<timestamp>`, which was OpenAgent knowing how the package names a
  branch and missed a branch the agent renamed.

## Removing a project
- "Remove project" takes the project off the dashboard's list and leaves the folder as it
  is. Deleting OpenAgent's files in the folder is a box in the same dialog, not ticked.
  Picked over deleting the files with every removal.
- With the box ticked, each tool removes its own files with its own clean-up command, and
  the dashboard asks each one. Picked over the dashboard deleting the tools' folders itself,
  which would have it keep a list of every tool's files.
- The agents' records on this machine go with the files, and the dialog says so before.
  Picked over keeping the records' branch in a folder OpenAgent has otherwise left.
- It never touches the remote, a commit, a branch with work on it, uncommitted work or a
  file git tracks. The dialog says what will go, and after it lists what went and what
  stayed. Picked over a removal that ends with one line, done or failed.
