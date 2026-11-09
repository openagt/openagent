import { onComputersThrough, onMachineAgentAccounts, onMachinePerson, onMachineVersions, sendLetMachineIn, sendMachineCode, sendMachineRemoveAgentAccount, sendRemoveMachineDevice } from '../rpc/machines.js'
import { onGitHostPeople } from '../rpc/people.js'
import { onPersonalFolder } from '../rpc/personal-folder.js'
import { sendSyncPersonalFolderOn, sendUseLoginsOn } from '../rpc/server-logins.js'
import type { HostServices } from './host-services.js'
import { addComputerThrough, addMachine, removeMachine, renameComputer, renameMachine } from './machines.js'
import { readModuleAgents } from './module-agents.js'
import { sendToScreen, watchScreen } from './screen.js'
import { ownComputerName } from './this-machine.js'

// The shell's services for modules (#1774) that are questions for the daemon: a project's runs and
// people, the saved machines, a run's live screen. They need nothing of the page on screen, so they
// are the same for the page's life; the shell adds to them the ones that do, which navigate or start
// a run.

/** The services only the shell can give: they go somewhere on the page, or land on a run. */
type ShellServices = 'openAgent' | 'openPage' | 'pageHref' | 'openSettings' | 'startRun' | 'configureRun'

export const DAEMON_SERVICES: Omit<HostServices, ShellServices> = {
  gitHostPeople: onGitHostPeople,
  // Asked at once by two cards, or soon again, the same runs are read once.
  agents: (projectId, wanted) => readModuleAgents(projectId, wanted),
  // This computer by the name the page says it everywhere else: one computer, one name.
  machines: async () => {
    const versions = await onMachineVersions()
    const name = ownComputerName(versions.name)
    return { ...versions, ...(name !== undefined ? { name } : {}) }
  },
  // Through the dashboard's own list, so the launcher's "Run on" shows the change at once.
  addMachine,
  removeMachine,
  renameMachine,
  renameComputer,
  letMachineIn: sendLetMachineIn,
  machineCode: sendMachineCode,
  computersThrough: onComputersThrough,
  machinePerson: onMachinePerson,
  removeMachineDevice: sendRemoveMachineDevice,
  machineAccounts: async (machineId, agent) => {
    const view = await onMachineAgentAccounts(machineId, agent)
    return view && view.accounts.map((account, i) => ({ id: account.id, name: account.name, own: account.own, ...(account.from !== undefined ? { from: account.from } : {}), first: account.state === 'in-use' || (i === 0 && view.accounts.length === 1) }))
  },
  removeMachineAccount: sendMachineRemoveAgentAccount,
  useLoginsOn: sendUseLoginsOn,
  syncDataOn: sendSyncPersonalFolderOn,
  agentDataRemote: async () => (await onPersonalFolder()).remote,
  addComputerThrough,
  watchScreen,
  sendToScreen,
}
