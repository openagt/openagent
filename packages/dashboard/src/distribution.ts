import type { DashboardDistribution } from '@openagt/ui/cli'

/**
 * The packages OpenAgent runs (#2394): its `openagent` command serves the dashboard with them
 * (`bin.ts`), and hands this file down to every process the dashboard starts, a run's own among
 * them, which loads each package's `./module` from here, resolved from this package's install.
 * The dashboard reads the rest of each package off it: its page and cards (`./dashboard`), its
 * commands, the kinds of data it provides.
 *
 * A package is every project's unless it says it is this computer's (`for: 'computer'`). A
 * plugin's is there only where its Enabled row is on, a person's switch in Settings › Plugins:
 * every plugin starts off but the ones that say `on`.
 */
const DISTRIBUTION: DashboardDistribution = [
  // The store: every module's data in its folder on this computer, the person's own folder synced
  // with a repository of theirs, and a shared project's on its repository's agent-data branch.
  { package: '@openagt/store-filesystem' },
  { package: '@openagt/store-git-repository' },
  { package: '@openagt/store-git-branch' },
  // git-branches: the run's checkout, its branch read back, the checkout reclaimed.
  { package: '@openagt/git-branches' },
  // github: the run's account and pull request; its skill is in every run of a project on GitHub.
  { package: '@openagt/github' },
  // skills: a run's skills linked where it works, and Settings › Skills, each project's own skills, listed.
  { package: '@openagt/skills' },
  // agent-driver: this computer's host, the agent's turns and the run's record, and the coding
  // agents' accounts with their rotation. This computer's: the accounts are its person's, and its
  // card and command are in no project.
  { package: '@openagt/agent-driver', for: 'computer' },
  // The coding agents a run can be on, the first the one a run names none: Claude Code and Codex,
  // the CLIs on this computer.
  { package: '@openagt/agent-driver-claude-code', for: 'computer' },
  { package: '@openagt/agent-driver-codex', for: 'computer' },
  // The Changes and Files panes.
  { package: '@openagt/ui-pane-changes' },
  { package: '@openagt/ui-pane-files' },
  // The prompts a person saved, theirs or a project's, which the message box loads.
  { package: '@openagt/saved-prompts' },
  // How a text in markdown looks, wherever the dashboard shows one.
  { package: '@openagt/ui-renderer-markdown', for: 'computer' },
  // The Overview's Human Queue: what waits on the person, in every project.
  { package: '@openagt/ui-card-waiting', for: 'computer' },
  // The person's name and picture, Settings › Profile.
  { package: '@openagt/user-info', for: 'computer' },
  // The agent profiles: their page, the profile every next run is on, and Default.
  { package: '@openagt/profiles', for: 'computer' },
  // notifications-command, a plugin that starts off: the person's command, run when a run on this
  // computer needs them.
  { package: '@openagt/notifications-command', for: 'computer' },
  // notifications-browser, a plugin that starts on, kept per person: desktop notifications while
  // the dashboard is open in a browser that allows them.
  { package: '@openagt/notifications-browser', for: 'computer', on: true },
  // ui-renderer-mermaid, a plugin that starts off, kept per person: a mermaid block drawn as its
  // diagram, a heavy library loaded only where there is one.
  { package: '@openagt/ui-renderer-mermaid', for: 'computer' },
  // host-claude-web, a plugin that starts off: "Run on" offers Claude Code on the web beside this
  // computer, in a project on GitHub, through the browser extension it brings.
  { package: '@openagt/host-claude-web', for: 'computer' },
  // The plugins kept per project: ask starts on, the others are a project's once a person switches them on.
  { package: '@openagt/ask', on: true },
  { package: '@openagt/logs' },
  { package: '@openagt/tickets' },
  { package: '@openagt/queue' },
  { package: '@openagt/browser' },
  { package: '@openagt/scheduled-agents' },
  { package: '@openagt/discord' },
  { package: '@openagt/github-auto-reply' },
  // host-github-actions: "Run on" offers GitHub Actions beside this computer, in a project on
  // GitHub whose repository has the workflow it brings.
  { package: '@openagt/host-github-actions' },
]

export default DISTRIBUTION
