import type { DashboardDistribution } from '@openagt/ui/cli'

/**
 * The packages OpenAgent runs (#2394): its `openagent` command serves the dashboard with them
 * (`bin.ts`), and hands this file down to every process the dashboard starts, a run's own among
 * them, which loads each package's `./module` from here, resolved from this package's install.
 * The dashboard reads the rest of each package off it: its page and cards (`./dashboard`), its
 * commands, the kinds of data it provides, its skill.
 *
 * Until each plugin has its Enabled row, an entry says whose its package is: every project's
 * unless it says `for`, a project's once it picked the package's skill (`picked`), or this
 * computer's (`computer`).
 */
const DISTRIBUTION: DashboardDistribution = [
  // git-branches: the run's checkout, its branch read back, the checkout reclaimed.
  { package: '@openagt/skill-branches' },
  // github: the run's account and pull request; its skill is in every run.
  { package: '@openagt/skill-github', skill: 'every run' },
  // agent-driver: this computer's host, the agent's turns and the run's record.
  { package: '@openagt/agent-runner' },
  // The Changes and Files panes.
  { package: '@openagt/dashboard-changes' },
  { package: '@openagt/dashboard-files' },
  // The runs' records, which every project's Log lists; its Logs page is a pick.
  { package: '@openagt/skill-logs', pages: 'picked' },
  // The door to this computer and its servers, and the accounts its runs use.
  { package: '@openagt/dashboard-devices', for: 'computer' },
  { package: '@openagt/skill-account-rotation', for: 'computer' },
  // The skills with pages.
  { package: '@openagt/skill-tickets', for: 'picked' },
  { package: '@openagt/skill-queue', for: 'picked' },
  { package: '@openagt/skill-browser', for: 'picked' },
  { package: '@openagt/skill-scheduler', for: 'picked' },
  // The skills alone: ask is in every run, the others a project picks.
  { package: '@openagt/skill-ask', for: 'picked', skill: 'every run' },
  { package: '@openagt/skill-discord', for: 'picked' },
  { package: '@openagt/skill-plan', for: 'picked' },
  { package: '@openagt/skill-plan-tickets', for: 'picked' },
  { package: '@openagt/skill-reply', for: 'picked' },
  { package: '@openagt/skill-triage', for: 'picked' },
  { package: '@openagt/skill-update-tickets', for: 'picked' },
  { package: '@openagt/skill-work-queue', for: 'picked' },
]

export default DISTRIBUTION
