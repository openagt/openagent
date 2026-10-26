// The dashboard's RPC surface (#405), served in-process by the daemon so `sendStart` can reach
// the daemon's own `startAgent`. The browser calls these by name over `POST /_rpc/<name>`; the
// dashboard's `rpc/` modules are typed stubs against these signatures, so a rename that misses
// one is a type error rather than a 404 at runtime.
export { onAgents, onModuleAgents, onAgent, onAgentsDoing, onDocs, onQueue, onOverview, onRecentAgents, onInterventions, onActivity, onDashboard, onGitHostHome, onRepositoryOffer, onGitStatus, onProjectFiles, onRetainedWorktrees, onAgentWorktree, onAgentHandoff, onBridgeQuestion, onBridgeStatus, onBridgeToken, onBridgeEvents, onBridgeAnswer, onBridgeBrowser } from './reads.js'
export { sendStop, sendChoice, sendBridgeAnswer, sendBridgeAnswerCancel, sendBridgeBrowser, sendMessage, sendStart, sendOpenInApp, sendRemoveWorktree, sendDeleteAgent, sendOpenPullRequest, sendPush, sendMergeBranch, sendMerge, sendCreateRepository } from './control.js'
export { streamAgentEvents, type LiveFeedEvent, type PartialMessage, type StreamSync } from './events.js'
export { onProjects, sendAddProject, sendStartedAgain, onCloneTarget, sendAddProjectFromAddress, sendRemoveProject, onRecordsReach, sendShareRecords, sendPickProjectDirectory, onOnboarding, onCommands, onStartCheck, type ProjectLauncher } from './projects.js'
export {
  onPreferences,
  savePreferences,
  patchPreferences,
  onProjectPresets,
  saveProjectPresets,
  onEditors,
  type SavePreferencesResult,
  type PatchPreferencesResult,
} from './preferences.js'
export { type EditorInfo } from '../dashboard/open-in-app.js'
export { onQuota } from './quota.js'
export { onModels } from './models.js'
export { onMachines, sendAddMachine, sendRemoveMachine, onMachinesReachable, onMachineVersions, sendProjectToMachine, onProjectOnMachine, onMachineStartCheck, onComputersThrough, sendAddComputerThrough, onMachinePerson, sendRemoveMachineDevice, sendRenameMachine, sendLetMachineIn, sendMachineLineLink, sendMachineCode, sendMachineTold, onMachineLogins, sendMachineLogins, type Machine, type MachineLoginsResult, type AddMachineResult, type MachineVersions, type ProjectOnMachine, type ComputersThrough, type MachinePerson, type MachineCode } from './machines.js'
export { onModules, runModuleCommand, runComputerCommand, runComputerCommandOn, readModule, type DashboardModule, type ModuleCommandResult, type ModuleReadResult } from './modules.js'
export { onProjectSkills, sendChangeSkills, sendProjectSkills, type ProjectSkills, type ProjectSkill, type ChangeSkillsResult } from './skills.js'
export { onPerson, type Person } from './person.js'
export { onGitHostPeople, type HostPerson } from './people.js'
export { onGitHosts, sendUseGitHostAccount, sendGitHostLogin, sendGitHostInstall, onAgentState, sendAgentFix, onProjectAccounts, sendProjectAccounts, type GitHostsView, type GitHostRow, type GitHostAccount, type GitHostProvider, type AgentState, type ProjectAccountsView, type ProjectAgentAccounts } from './logins.js'
export { onServerLogins, sendUseLoginsOn, sendAllowLogins, sendSettleLogin, type ServerLoginsView, type ServerLogins, type LoginThere } from './server-logins.js'
export { onCopiedLogins, sendCopiedLogin, sendForgetCopiedLogin, sendKeepCopiedLogin, sendCopiedUsage, type CopiedView } from './copied-logins.js'
export { onAgentAccounts, sendAddAgentAccount, sendAgentAccountCode, sendRemoveAgentAccount, sendUseAgentAccountFirst, sendNameOwnAgentAccount, type AccountsAgent, type AccountRow, type AccountWindow, type AccountAdding, type AccountsView, type AccountResult } from './accounts.js'

import * as reads from './reads.js'
import * as control from './control.js'
import * as projects from './projects.js'
import * as preferences from './preferences.js'
import * as quota from './quota.js'
import * as models from './models.js'
import * as machines from './machines.js'
import * as modules from './modules.js'
import * as skills from './skills.js'
import * as person from './person.js'
import * as people from './people.js'
import * as accounts from './accounts.js'
import * as logins from './logins.js'
import * as copiedLogins from './copied-logins.js'
import * as serverLogins from './server-logins.js'
import { streamAgentEvents } from './events.js'

/** One RPC: called with whatever the browser sent, answering with whatever JSON.stringify keeps. */
export type RpcHandler = (...args: never[]) => unknown

/**
 * Every RPC the mount will answer, by name.
 *
 * Built from the modules' own exports rather than listed by hand, so a function that is exported
 * and simply never registered — the failure that shipped per-project preferences broken (#866),
 * a 400 and nothing else — cannot happen: the name IS the export name.
 *
 * Null-prototype, because the name is a path segment off an unauthenticated request and this table
 * is indexed by it directly. With `Object.prototype` behind it, `POST /_rpc/constructor` found
 * `Object` and answered 200 with whatever it was handed, and `__proto__` / `toString` / `valueOf`
 * were reachable too — 500s rather than the 404 a name that is not an RPC has to get.
 */
export const RPC_HANDLERS: Record<string, RpcHandler> = Object.assign(
  Object.create(null) as Record<string, RpcHandler>,
  Object.fromEntries(
    [reads, control, projects, preferences, quota, models, machines, modules, skills, person, people, accounts, logins, copiedLogins, serverLogins]
      .flatMap(module => Object.entries(module))
      .filter((entry): entry is [string, RpcHandler] => typeof entry[1] === 'function'),
  ),
)

/** The live event stream, which is a subscription rather than a call — see `rpc-serve.ts`. */
export const RPC_EVENT_STREAM = streamAgentEvents
