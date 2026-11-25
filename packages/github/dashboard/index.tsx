// github's UI part: the package's `./dashboard` export. OpenAgent's own GitHub accounts, on the
// Permissions page (`permissions.section`), with the dialog that adds one, which also fixes "Connect
// GitHub" wherever its Node part says it (`attention.fix`); the account a run works as, a line of
// the gear's menu under the message box (`composer.control` at `setup`), with the levels of the
// Auto menu that open a pull request (`composer.auto`) and the branch it goes into; the repos its accounts
// reach, in the project picker (`composer.where`), with the users and organizations named in
// Settings › GitHub (`settings.section`); the pull request presses of an ended run's work, in the
// bar above its message box (`chat.handoff`), and the run's requests at the end of the row above
// it (`chat.labels`); the project's page on GitHub and a repository created
// for it, in the project's menu and a session's (`project.menu`, `chat.menu`); and where `#12` in
// a session's chat leads, the issue or pull request of that number (`chat.references`). What it
// reads and does is its own server part's (`../src/server.ts`).
import { Github } from 'lucide-react'
import { NO_PROJECT, defineUiModule, type UiActionAt } from '@openagt/ui/module'
import { ADD_ACCOUNT } from '../src/ids.js'
import { AccountControl } from './AccountControl.js'
import { AccountsSection } from './Accounts.js'
import { AddAccountDialog } from './AddAccount.js'
import { server } from './calls.js'
import { handoffActions } from './handoff.js'
import { menuActions } from './menu.js'
import { PrBaseControl } from './PrBaseControl.js'
import { RunPrs } from './RunPrLabels.js'
import { RepoOwnersSettings } from './RepoOwners.js'

/** The sentence the levels that open a pull request add to the prompt, as git-branches' levels open theirs. */
const PUBLISH_OPENING = 'When you finish, if you changed any file, commit your work, push your branch'

/** Whether a project is offered the levels that open a pull request: its origin is on GitHub. A session with no project publishes its copies, wherever each is. */
const onGithub = (project: { remote?: string | undefined } | undefined) => project === undefined || project.remote?.split('/')[0] === 'github.com'

/** Add an account, gh installed on the way where it is missing: the fix of "Connect GitHub". */
const addAccount: UiActionAt<'attention.fix'> = {
  place: 'attention.fix',
  id: ADD_ACCOUNT,
  label: 'Add a GitHub account',
  Dialog: ({ onDone }) => <AddAccountDialog open onClose={added => onDone(added !== undefined ? { ok: true, said: `@${added} is added.` } : undefined)} />,
}

export default defineUiModule({
  name: 'github',
  hooks: {
    'ui.view': [
      { place: 'permissions.section', id: 'accounts', label: 'Git host accounts', View: AccountsSection },
      { place: 'composer.control', id: 'account', at: 'setup', order: 80, View: AccountControl },
      { place: 'composer.control', id: 'pr-base', at: 'setup', order: 85, View: PrBaseControl },
      { place: 'chat.labels', id: 'prs', order: 90, View: RunPrs },
      { place: 'settings.section', id: 'github', title: 'GitHub', icon: Github, View: RepoOwnersSettings },
    ],
    'ui.action': [addAccount, ...handoffActions, ...menuActions],
    'ui.option': [
      { place: 'composer.auto', id: 'pr', order: 30, label: 'Open PR', description: 'It commits, pushes its branch and opens a pull request.', sentence: `${PUBLISH_OPENING} and open its pull request.`, offered: onGithub },
      {
        place: 'composer.auto',
        id: 'merge',
        order: 40,
        label: 'Merge on green',
        description: 'It commits, pushes its branch and opens a pull request set to merge once its checks pass.',
        sentence: `${PUBLISH_OPENING} and open its pull request, set to merge on its own once its checks pass.`,
        offered: onGithub,
      },
      { place: 'chat.references', id: 'issues', issue: (project, number) => (project.remote?.split('/')[0] === 'github.com' ? `https://${project.remote}/issues/${number}` : undefined) },
      {
        place: 'composer.where',
        id: 'repos',
        order: 100,
        label: 'On GitHub',
        description: "Your OpenAgent accounts' repos, and those of the users and organizations named in Settings › GitHub.",
        loadingWords: 'Asking GitHub for repos…',
        repos: async host => {
          const read = await server(host).repos(NO_PROJECT, {})
          return {
            repos: read.repos.map(repo => ({
              address: repo.address,
              label: repo.address.split('/').slice(1).join('/'),
              ...(repo.description !== undefined ? { detail: repo.description } : {}),
              ...(repo.private ? { private: true as const } : {}),
              why: repo.from,
              ...(repo.pushedAt !== undefined ? { pushedAt: repo.pushedAt } : {}),
            })),
            ...(read.loading ? { loading: true } : {}),
            ...(read.unreached ? { unreached: 'GitHub did not answer: some repos are missing.' } : {}),
          }
        },
      },
    ],
  },
})
