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
  { package: '@openagt/skill-branches' },
  // github: the run's account and pull request; its skill is in every run of a project on GitHub.
  { package: '@openagt/skill-github' },
  // skills: a run's skills linked where it works, and Settings › Skills, each project's own skills, listed.
  { package: '@openagt/skills' },
  // agent-driver: this computer's host, the agent's turns and the run's record.
  { package: '@openagt/agent-runner' },
  // The Changes and Files panes.
  { package: '@openagt/dashboard-changes' },
  { package: '@openagt/dashboard-files' },
  // How a text in markdown looks, wherever the dashboard shows one.
  { package: '@openagt/ui-renderer-markdown', for: 'computer' },
  // The Overview's Human Queue: what waits on the person, in every project.
  { package: '@openagt/ui-card-waiting', for: 'computer' },
  // The person's name and picture, Settings › Profile.
  { package: '@openagt/user-info', for: 'computer' },
  // devices, a plugin that starts off: the door to this computer, and its other computers and
  // servers. Then the accounts its runs use.
  { package: '@openagt/dashboard-devices', for: 'computer' },
  { package: '@openagt/skill-account-rotation', for: 'computer' },
  // notifications-command, a plugin that starts off: the person's command, run when a run on this
  // computer needs them.
  { package: '@openagt/notifications-command', for: 'computer' },
  // notifications-browser, a plugin that starts on, kept per person: desktop notifications while
  // the dashboard is open in a browser that allows them.
  { package: '@openagt/notifications-browser', for: 'computer', on: true },
  // ui-renderer-mermaid, a plugin that starts off, kept per person: a mermaid block drawn as its
  // diagram, a heavy library loaded only where there is one.
  { package: '@openagt/ui-renderer-mermaid', for: 'computer' },
  // The plugins kept per project: ask starts on, the others are a project's once a person switches them on.
  { package: '@openagt/skill-ask', on: true },
  { package: '@openagt/skill-logs' },
  { package: '@openagt/skill-tickets' },
  { package: '@openagt/skill-queue' },
  { package: '@openagt/skill-browser' },
  { package: '@openagt/skill-scheduler' },
  { package: '@openagt/skill-discord' },
  { package: '@openagt/skill-reply' },
]

export default DISTRIBUTION
