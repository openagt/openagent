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
- A subagent's row in its main agent's chat opens it in a pane beside the chat: its model and
  the whole prompt it was given, then what it said and did. Picked over opening its page,
  which takes the person away from the main agent's chat. Both kinds of subagent have the same
  row, a subagent of the coding agent's own marked as having no branch.
- The subagents one turn started are one block under a line saying how many, how long and
  what they cost, each with a row of its own. Picked over Claude Code's one collapsed row that
  turns through the names of the ones still working: at most four run at once, and the line
  above the message box already says how many are running.
- Which package provides a kind of data when several installed packages declare it: the
  project's own package.json says, under the same `openagent` key with the package's name
  as the value; several and no line means nothing provides it, and the project's banner
  says why. Picked over the first in dependency order, taken silently, and over routing by
  the remote's host.
- A skill's text names its package in its front matter, `package: "<name>@<range>"`, and a
  project that holds the text with no package installed (`npx skills add` copies the text
  alone) has the package fetched the way `npx` fetches one: what it declares comes through
  the same `openagent` key as an installed one's. Picked over the text carrying the command
  itself, which would have been a second way to declare, for the git host alone.
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
- Notifications are the browser's only: they alert in the open tab. Posting to a
  channel is a skill's, fired by the tool that runs the agent when a run ends. Picked over
  the dashboard's Discord watchers, which posted only while the dashboard was running.
- The themes keep Claude Code's levels in Everforest's colors. Dark is Everforest on its
  darker steps: the page on its dimmest background, the sidebar a step below it, panes a
  step above, fills and lines close to them. Light is near-white in the greens' cool grey:
  the sidebar a step below the page, the message box and the panes in white above it. The
  text and the accents are Everforest's as on the landing page, whose surfaces stay the
  medium ones. Picked over the landing page's exact values, which read light beside Claude
  Code's, and over one white for every surface in the light theme.
- The message box is laid out as Claude Code's: a filled box with rounder corners holding the
  "+" menu, the text and the send; a row under it with the Context and Auto menus, and the
  model at the right with its effort in a quieter tone, one menu for both. Where the agent
  starts (the machine, the project, the branch) is a row above the box, in the same plain
  words. Picked over bordered chips above the box, over every item in one row under it, and
  over the effort as a menu of its own.
- A session's box has the launcher's Context and Auto menus too, and its pull requests, every
  one the run opened, each a label with its number and state. Picked over the last one alone:
  a run that moved its work to a new branch opened another. What the Context picks and a changed Auto go with the next
  message: the Context as the line at its end, Auto as how far the run takes its work from that
  message on. Picked over a session bound for its whole life to the level it started at, where a
  person who liked the work had no way to have it published but a new run.
- The bar above a session's box goes once its pull request is merged or closed. Picked over the
  bar staying with the request as a label: the labels under the box already say it.
- The foot of the sidebar is the person: their picture and first name, as one row that opens
  one menu with their whole name, the theme, the notifications and Settings. The name is git's, the picture the
  git host's, asked through the project's git host package. The project select stays at the
  top, beside the pages it changes. Picked over a row of three icons, and over the project
  select at the foot.
- The dashboard grows by modules: a package that adds to the dashboard (pages, Overview
  cards, link actions, panes beside the chat, a run's summary, Settings sections) is a module;
  a skill that brings pages is a module that is also a skill. A module is one OpenAgent
  brings itself, or a package among a project's dependencies, whoever wrote it. The
  Files pane is the first module that is no skill. Picked over keeping Files a folder
  inside OpenAgent, which gave it a boundary but taught the module contract nothing, and
  named module over widget.
- What a module shows beside the chat is a pane, as on Claude Code on the web. Each pane
  has an icon at the end of the page's top bar, which opens and closes it. The open panes
  are cards in one column, in the order they were opened, the agent's browser among them.
  The line between the chat and the column, and the line between two panes, is dragged.
  Each agent's page keeps its own sizes, and a page never sized starts with the last sizes
  set on any. On a phone the column lies over the chat. Picked over one side panel with a
  tab per module, which showed one of them at a time; over the browser in a column of its
  own; and over one size for every page.
- Changes and Files are two modules that share nothing: the Files tree marks no file as
  changed. Picked over one module for both panes, and over the Files tree asking Changes
  for its marks, which would tie the two.
- In the Files pane, as in Claude Code on the web, one click on a file shows it in a
  preview tab, a double click keeps it open as a tab, and a right click attaches it to the
  next run's Context or copies its path or its name. Picked over a click that added the
  file to the Context, and over a card that showed the file while the pointer rested on it.
- The Changes pane shows every changed file's diff, one under another, as Claude Code on
  the web does, and a click in its list scrolls to that file's. Picked over one diff at a
  time beside the list.
- A pane too narrow for both hides Files' tree and Changes' list, as Claude Code on the web
  does: the button at the start of the pane's header shows it in the pane's place until a
  file is picked from it. Picked over the tree or the list squeezed above the file.
- The search button of the Files pane shows the tree and puts the cursor in its "Filter
  files…". Picked over a search box of its own.
- Files and Changes colour code by its language, with Shiki's Everforest themes, the family
  the dashboard's colours come from. Picked over plain text.
- A file's icon is Material Icon Theme's. Picked over vscode-icons, Catppuccin's outlines, and
  a small two-tone set of our own.
- The packages every project wants are built in: OpenAgent depends on them and uses them
  for every project through the same contract as any package (a module by its
  `./dashboard` export, a provider of a kind of data and the writer of its hook lines by
  its `openagent` key). They are Changes, Files, the runner, the packages that read a
  project's runs and checkouts, and the GitHub package, so an empty folder starts an
  agent, shows it, and can be put on GitHub. A built-in git host is a project's only when the
  project's remote is on that host: it was not chosen by the project, so it does not
  answer for a project on another host. Picked over each project installing them itself,
  which left a project with nothing installed unable to start an agent or to see one.
- A project has a skill when every run gets it by default (`@openagt/start` names those), or
  when the skill's text is in the project, where the coding agents read it
  (`.claude/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`). OpenAgent brings the
  packages of the skills that have pages itself (tickets, queue, orchestration, browser,
  scheduler) and gives each, with its page, its cards and its data, to every project where
  the skill is a default, else to the projects that hold its text; deleting the folder of a
  skill that is no default takes them away. Picked over
  a project's pages coming from its own `package.json`, which needed an install in every
  project, and which a project without Node could not have.
- Three lists name the packages OpenAgent brings, the ones every project has, the ones
  a project picks and the ones that are the computer's, and nothing else in OpenAgent
  names a package. One of those names among a project's own dependencies is not read:
  OpenAgent's copy and its rule are the only ones. Picked over a project's own copy
  winning, which gave one package two ways into a project.
- The door to this computer and the servers it installed OpenAgent on are the
  computer's, not a project's: their entries in Settings are there with no project
  added, and their commands run in no project. Picked over giving them to every project
  and running their commands in the first one, which left a computer with no project, as
  a server is when it was just connected, with no way to let a phone in; and over a
  starter project made on every server, one nobody asked for.
- "Add project" stays small: it writes no skill. The launcher's row under the box then has
  "Skills", after Auto, which opens the list with ticks of the skills a project picks
  beyond the defaults. Picked over "Add project" writing the skills itself, which put files
  into every project a person adds. The button was picked over a line of its own on the
  project's page ("This project has 4 of 25 skills", with an "Add skills" button), which
  stood there also when it had nothing to offer, and over an item in the project's ⋮ menu,
  where it was not seen.
- OpenAgent has no command of its own to give a project skills: the Skills list in the
  dashboard, or `npx skills add openagt/openagent` in a terminal, which writes the same
  texts for any agent. Picked over `npx @openagt/init`, a second list with ticks to keep in
  step with the dashboard's.
- A skill the project picks is one tracked file, `.agents/skills/<name>/SKILL.md`, where
  Codex reads it, and one tracked link at `.claude/skills/<name>`, where Claude Code reads
  it, the shape `npx skills add` writes too. Nothing else: no `package.json`, no install,
  so a Node project, a PHP project and an empty folder get exactly the same. Picked over
  installing the skills' packages into the project.
- The scheduler is one more skill in the list, ticked by default. Ticking it also writes its
  two lines into the project's hooks file, which is this machine's and outside git, so it
  starts with the dashboard; unticking it takes them out and stops it. A project that got the
  text another way, `npx skills add` say, gets no lines: while the scheduler is off, the
  Automations page says so and names the two commands that start it. Picked over a switch
  on that page that writes the lines, one more control for a line that already says it.
- A project is also added by its repository's address, for a computer that does not have
  its folder, as a server: OpenAgent clones it into `~/projects/<its name>` and says where
  it went. Picked over asking for the folder at every add, one more thing to read.
- When a skill in a project has a newer version, the project's page names it ("The
  orchestration skill has a newer version") with an "Update" button; the texts are written only on that press,
  and sent on as a save is. Picked over a count of skills that "have a newer text", which
  said neither which skill nor what a text is, over saying nothing until asked, and over
  writing every text again unasked.
- A save of the skills list, and Update, take the change to where agents start from in the
  same press: one commit of the skill files it wrote or deleted, those alone, then those
  files pushed to the remote's default branch, or, where that push is refused, to a branch
  of OpenAgent's own with a pull request opened for it, or that branch alone to merge by
  hand where no git host package opens one. Nothing else of the person's is pushed. With
  no remote the commit is all it takes. Picked over offering a commit and
  leaving the push to the person, three steps with a git word at each before an agent had
  the skill, and over committing and pushing unasked.
- What a project's skills need from the person is a card under the agents that wait on
  them, in the same column, shown only while there is something to do: a newer version,
  skills on this computer only with a "Send" button, or skills in a pull
  request or on OpenAgent's branch, waiting for a merge. Once agents have them the card is
  gone, with no line saying so. While a skill is not yet on the branch agents start from,
  the launcher does not take its command, so it never offers a command the agent does not
  have. Picked over a line across the top of the page, which read as part of the page's
  frame; and over a line for a project with no skill yet, which the default skills every
  run gets made untrue.
- Settings is a dialog over the page you are on: a list of entries on the left, the picked
  entry's settings on the right. The address carries it, so a reload or a link opens it
  again, and closing it leaves the page as it was. Picked over a page of its own, which took
  you away from what you were doing and put a second list beside the sidebar.
- The address starts with the project picked in the sidebar, by its folder's name:
  `/gemstack` starts an agent there, `/gemstack/overview` and `/gemstack/logs` are the
  Overview and a module's page with that project picked, `/gemstack/<agent>` one agent. With
  every project picked the address has no project: `/`, `/logs`; only an agent's page and
  the "New agent" page, which belong to a project, add `?all`. A name that cannot be an
  address, because a project added before has it or a page has that word, is the project's
  id with its hash. The id still opens the project, and stays what everything else knows
  it by. Picked over `?project=` and over the id with its hash, which named the project in
  a way a person neither reads nor types.
- The list has two groups, by whose the settings are: first, with no title, OpenAgent's own
  and the packages that are the computer's; then "Project", the packages a project has, each
  saved in that project. The project group shows the project picked in the sidebar,
  and has its own select. With every project picked, a change saves to each project that
  has the package, and a setting they hold differently reads "Mixed". Picked over one list
  of every project's packages saving one value to all of them, and over a tab per project
  inside each entry, which crowds with many projects and asks for the project again in
  every entry.
- A module may bring an entry of Settings, with its name and icon, where a project has its
  package. It reads and writes through the package's own command. Picked over OpenAgent's
  own sections knowing a package's file and a hook line per setting, which made every
  package's settings a change to OpenAgent.
- The onboarding checklist is the Overview's alone. Picked over keeping a copy in Settings,
  where it is no setting.
- The scheduler is a package's: its Automations page, its Settings entry and its Overview
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
  that polls every 8 seconds and an opened file read again every few seconds.
- A package that is the computer's may bring a service: a command of its own
  that OpenAgent runs for as long as it runs itself, and tells its own address. Picked
  over a line in each project's hooks file, which is a project's and shared with its team,
  where a service is one computer's; and over running it inside OpenAgent's own process,
  where a fault in it is a fault in OpenAgent.
- The chat says in its own words what the terminal says with its glyphs: how a run ended,
  what it reported, where its work is, what the model's quota is doing. A grey word for what
  happened, and the thing it happened to beside it, as a tool call's row reads. Picked over
  showing the terminal's own line in the chat, where `■ stopped`, a two-space indent and a
  time spelled for a machine say nothing to a person reading a conversation.
- A run of the agent's steps is one line that counts its commands and names the file its edits
  changed, with the lines added and removed, as Claude Code on the web says it: "Ran 2
  commands, edited README.md +12 −54". Picked over the count alone, which Claude Code said
  before.
- The chat shows a `screen` line as one line, which opens the pane its package brings, and
  knows nothing of what the screen is. What the screen shows is streamed from the computer
  the run is on, through OpenAgent, as pictures: to this computer, to a phone, to another
  computer. Picked over framing the page that computer serves, which showed on that
  computer only; and over a `browser` kind the dashboard renders itself, which the next
  package showing something would have had to repeat.

- A run goes by one name in every list: its short name, else what was asked, else its branch.
  The Human Queue, the launcher's "Waiting on you" and the sidebar say it alike. Picked over
  each list naming a run its own way (the prompt in one, the question or the pull request's
  title in another), which made one run look like three.
- What waits on the person is one list, said the same wherever it shows: the Human Queue on
  the Overview, and "Waiting on you" on a project's launcher, that project's rows only. Each
  row says what is needed in two words ("Needs answer", "Needs commit", "Needs PR" or "Needs
  push", "Needs merge"), the run's name, then what it is about. The first five show, and a
  line offers the rest. Picked over the launcher listing only the questions, and over words
  that said what had not happened ("Not committed"), and over pages of rows.
- The sidebar lists the runs by when they were started, unless the person picks the last
  update or the name from the button beside "Recent agents". Picked over the runs that hold a
  checkout first, which moved a run answered days later to the top and back once its checkout
  went, and over the last update as the default, Claude Code's, which moves a row while a
  person talks to it.

## What runs log in with
- Settings has one page for it, Accounts: the coding agents' cards, then the git hosts', each
  a card per tool drawn from its package's answers. Picked over two pages, Agent accounts and
  Git hosts, which a server's logins would have split in two: a git host's card says the package's name for the host, its
  word for a pull request, the accounts its tool knows and the one runs use, so OpenAgent
  names no git host. One card per host the projects' remotes are on, a self-hosted one its
  own; a host no package answers for is a plain line, and a project with no remote is none.
  A card is green when there is nothing to do, amber for a step, grey for a tool not here.
- What runs need and do not have is a first step of the Overview's onboarding, shown only
  while something is missing (install the tool, then log in), the same press on the start
  form's red line, and a dot on the person's picture whose menu says what. Picked over a
  login step every new install walks through: the onboarding is heavy enough.
- A project's own accounts are a Settings page of that project, shown only for a kind the
  computer has two or more of, "same as this computer" until one is picked.
- Every coding agent's accounts are the same card, menu row and pick, with the agent's own
  words: adding one asks whose it is, then the agent's sign-in in this computer's browser.
  Picked over showing the email Codex's sign-in tells, which only Codex could, and would
  have made one button work two ways. The email only refuses an account added twice.
- How full an account is reads as each of its windows by how long it lasts (5 h, week,
  month), the longest on its bar. Picked over a week and a session, which is Claude's
  shape: Codex's free plan has one window, a month.
- A page never says "this computer": a login is named by the computer it is on. Picked over
  "this computer", which a phone reading a server's page read as the phone or the laptop.

## A server uses the person's own logins
- A server of the person's uses the accounts their own computer is logged in to, every coding
  agent's and git host's, each a login of the server's own that the computer makes for it. One
  that can go as it is goes with nothing to press (a git host's token, a Claude account added
  on the computer); one that cannot is made anew with one press in the computer's browser (the
  computer's own Claude login, any Codex account). Picked over copying every login as it is,
  where the computer and the server renew the same login and one of them is logged out, and
  over logging in again on the server.
- A login on a server never logs another device out, and taking it off deletes it there only.
- The person says once that a server uses their computer's logins: a step of setting the
  server up, or a bar in Accounts for a server set up before. Picked over a login step for
  each login of each server.
- A login the computer no longer has, or another account it switched to, changes nothing on
  the server until the person says: the server keeps what it has meanwhile. A new account just
  goes there. Picked over the server following at once, which could leave its runs with no login.
- Only a person's own computers' logins are used. A person with no computer of their own logs
  in on the server's own page, in the same cards, the browser step on their own device.
- The person's settings follow the same way: how OpenAgent looks, what it tells them, what a run
  starts with, the onboarding hidden. One changed on the server's own page stays until the same
  one changes on the computer. A computer's own settings (its editor, its browser bridge) stay
  its own. Picked over each OpenAgent keeping its own settings, where a phone showed what the
  laptop had hidden.

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
  beside Start: Off, Commit, Publish branch, Open PR, Merge on green. Off adds nothing to the
  person's message: whether the agent then commits is its own, by the branches skill in its
  checkout, where Commit asks for it. Picked over the name "Nothing", which promised that
  nothing is committed. It is saved like the
  coding agent. A project with no git host package
  is offered Off, Commit and Publish branch only. A project with no remote can publish
  nothing, so it is offered Off and Commit, and a saved pick it is not offered counts
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
- What would stop a run is said above the message box, over the page, with the press that
  fixes it inside the same box: logging the coding agent in, on this computer. Picked over
  saying it under the box, where it was missed, with the press on a line of its own.

## Running on another machine
- The machines a person saved are kept in their home file, beside their projects and their
  settings, and a machine's key is never handed to a browser. Picked over the browser's own
  storage, where each browser had its own list and the daemon, which makes the calls, did
  not know the machines.
- A machine is added with the link it gives for a new device, pasted. This computer gets a
  key of its own there, and removing the machine takes that key out. Picked over starting
  the other machine open to the network with one key every caller shared, and over removing
  the list of machines until a server can be connected.
- A server is reached through what it opened to the network, as a phone reaches a laptop,
  with a key of this computer's own. Picked over a line held open over SSH, a second way in
  to keep safe, which has to be opened again after every sleep.
- This computer remembers what a server's key is known by, from the server's link, and
  calls only what shows that key. Picked over trusting any certificate for the server's
  number, which the number's next owner can get.
- A run sent to another machine names its project by the address its repository was cloned
  from, and starts in that machine's own copy of it. Picked over the folder's name, where
  two projects named alike are mixed up and a renamed folder breaks the link, and over
  linking the two folders by hand, a step for every project on every machine.
- A machine that does not have the project clones it first, by itself, from the project's
  repository address and with its own logins, into `~/projects/<its name>`, and the launcher
  says so while it waits; the run then starts. Picked over starting nothing and telling the person to add the project
  there, a step on another computer for every project, and over starting in the folder that
  machine's OpenAgent was started in, which may be another project.
- With a machine picked, what would stop a run is asked of that machine as soon as it is
  picked, from its own copy of the project, and said naming the machine. A coding agent
  logged out there comes with this computer's logins for the machine, as Settings › Accounts
  offers them. Picked over learning it only after the Start, from the machine's refusal, in
  words written for that machine's own terminal.
- A project with no repository address runs on this machine only, and "Run on" says so.
  Picked over sending the repository straight to the other machine, a second road for
  code beside the git host.
- On screen, a computer that runs agents is a machine. Device is kept for a phone or a
  browser that gets in. Picked over device for both.
- A run shows where it runs, on this computer or on a saved machine, as one icon with its
  words on hover, and the same wherever it is listed and however it was started. Picked over
  showing where it was started from, and over more words in the run's header.
- On a page a phone opened, the computer that runs OpenAgent is named by the address the phone
  reached it at. Picked over "This machine", which the phone's holder reads as the phone.

## Saying something to a run
- What a person says reaches a run through what the run's tool reads: a line in the run's
  inbox file while the run works, the project's `resume` line once it has ended. Picked
  over a channel of ours that every tool would have to learn.
- A run that ends while the line is on its way has its line taken back out of the inbox
  and resumed instead. Picked over leaving it for a run that will never read it.
- A question the agent waits on is a card in the chat, right under what the agent said, and
  is answered there; the turn's copy and time go under the card. Picked over a panel above
  the message box with an "Asking" line in the chat, which put an empty line and a gap
  between the agent's words and its question.
- An answer is checked against the question the run's diary holds open, and handed over as
  the option's label. Picked over passing the pick through: only what the agent offered
  can be answered, and the agent reads words, not ids.
- Stop is a signal to the process the run's card names, whoever runs it. Picked over a
  message to the run: a stop that has to be read is not a stop.
- A run another computer started, which is no saved machine, is only read here: in place
  of the message box a line says where it runs. Picked over a box that continued it here,
  which moved the run to this computer under its id, with this computer's logins and none
  of its conversation. A press that continues it as a new run here can come later.

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
  changed nothing, and its Files pane shows the project's files. Picked over saying its
  changes are gone, which read as lost work. No other run is judged so.

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
