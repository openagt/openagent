// `@openagt/ui/module`: what the dashboard offers a module (#1774).
//
// A module is a package that adds to the dashboard; its browser part is the file it exports as
// `./dashboard`. The dashboard finds it in a
// project's dependencies, imports it at runtime, and reads its default export, a
// `UiModuleDefinition`: the UI hooks it fills, each at a place of the shell's, as `@openagt/hooks/ui`
// declares them and this file offers them, beside the shell's host and its design kit (#2394). The
// browser part imports `react` and this file as bare names and bundles neither: the dashboard's
// import map points both at the dashboard's own running copies, so a module renders inside the same
// React tree and uses the same components as the rest of the page.
//
// This file IS `@openagt/ui/module`: the dashboard's build emits it as its own entry (`/assets/host/module-<hash>.js`),
// sharing every chunk with the dashboard itself. Nothing here names a skill.
import type { Health } from '../../src/health.js'
import { createContext, useContext } from 'react'
import type { AgentStatus } from '../../src/index.js'
import type { ModuleAgent, ModuleAgentsWanted } from '../../src/dashboard/module-agents.js'
import { callModule, runComputerCommand, runComputerCommandOn, runModuleCommand } from '../rpc/modules.js'
import type { ModuleCallResult, ModuleCommandResult } from '../rpc/modules.js'
import type { ComputerRpcClient, RpcClient } from '@openagt/hooks/rpc'
import { DaemonDown } from '../lib/use-daemon-health.js'

export type { ModuleCallResult, ModuleCommandResult, AgentStatus, Health, ModuleAgent, ModuleAgentsWanted }
export type * from '@openagt/hooks/ui'
export { defineUiModule } from '@openagt/hooks/ui'

/** What starting a run answered: the run's id, or in words why there is none. */
export type StartRunResult = { ok: true; agentId: string } | { ok: false; error: string }

/**
 * What the dashboard gives the module it is rendering. Every service is generic — a project, a
 * run, a page, a command — and none names a skill: what a module composes out of them is its own.
 */
export interface ModuleHost {
  /** The package the module came from: the one whose commands {@link runCommand} runs. */
  package: string
  /**
   * Run one of the module package's own commands in one project and get its JSON output: the
   * same command an agent runs (`npx <command> …`). `command` names one when the package has several.
   */
  runCommand(projectId: string, args: string[], command?: string): Promise<ModuleCommandResult>
  /**
   * The same, for a command that changes the project's data (a claim released, an entry added):
   * the dashboard then syncs the project's data with origin and forgets what it had read, so the
   * change shows at once instead of at the next sync. A link action's host runs every command so.
   * `input` is what the command reads on standard input: a whole file it writes, a ticket say.
   */
  act(projectId: string, args: string[], command?: string, input?: string): Promise<ModuleCommandResult>
  /**
   * Run one of the module package's own commands in no project, for a package that is this
   * computer's (the door to it, its servers, its accounts): what such a package keeps is the
   * computer's, so its page reads and changes it with no project added. Refused for any other
   * package. `input` is what the command reads on standard input: a secret, which no other
   * program on this computer sees there, as it would among the arguments.
   */
  runComputerCommand(args: string[], command?: string, input?: string): Promise<ModuleCommandResult>
  /**
   * The same, on a saved machine whose package of the same name is that computer's: what the
   * package keeps over there, read and changed with this computer's key there, as that machine's
   * own page would. Not for a computer reached through a server.
   */
  runComputerCommandOn(machineId: string, args: string[], command?: string): Promise<ModuleCommandResult>
  /**
   * Call one of the functions of the module's own server part (its package's `./server`, each a
   * `read` or an `act` of `@openagt/hooks/rpc`) in one project, with `input`, a JSON object;
   * `input.agentId` names the run the call is about, when it is about one. Answered in the
   * daemon's own process, so it suits a read made every few seconds. {@link rpcClient} types it by
   * the server file.
   */
  call(projectId: string, name: string, input: object): Promise<ModuleCallResult>
  /**
   * The same in no project, for a package that is this computer's: what such a module keeps is the
   * computer's or the person's, read and changed with no project added. {@link computerRpcClient}
   * types it by the server file.
   */
  callComputer(name: string, input: object): Promise<ModuleCallResult>
  /** Open one agent's page in the dashboard: its live feed while it runs, its record after. */
  openAgent(projectId: string, agentId: string): void
  /** The address of one agent's page: a link's `href`, for a link that also opens in a new tab. */
  agentHref(projectId: string, agentId: string): string
  /**
   * Open a page a module adds (this one's or another's), at a sub-path, in the project picked in
   * the dashboard, or in `projectId`, which is then the one picked: `openPage('tickets', [file], projectId)`.
   * A page the picked project's packages do not add shows "No such page". With `beside`, the page
   * is one of the same thing as the page shown (a ticket's other tab): it is entered from where the
   * page shown was, so `backToPage` from it goes there as it was left.
   */
  openPage(segment: string, path?: string[], projectId?: string, options?: { beside?: boolean }): void
  /**
   * Write a pick the page shown keeps in its address, in place of the address it had, so Back
   * steps over it: its sub-path, its query (without `?`), or both. The query left out stays.
   */
  adjustPage(path?: string[], query?: string): void
  /** The address `openPage` with the same arguments goes to: a link's `href`, for a link that also opens in a new tab. */
  pageHref(segment: string, path?: string[], projectId?: string): string
  /**
   * Go back to a page at a sub-path, in any project: by the browser's Back when the page shown was
   * opened from it, or beside a page that was, so it is as it was left (its filters, its scroll);
   * else `openPage` with the same arguments. A list's way back from one of its items: `backToPage('tickets')`.
   */
  backToPage(segment: string, path?: string[], projectId?: string): void
  /**
   * Open an entry of Settings over the page, by its id: `openSettings('devices')`; with `item`, at
   * that page inside it. From inside Settings, it moves to that entry in place: Back and closing
   * still go to the page under it.
   */
  openSettings(entry: string, item?: string): void
  /**
   * The accounts behind a project's commit emails at its git host, each with its login and picture:
   * an email the host knows nobody for, or a project with no git host, is left out. Kept a day.
   */
  gitHostPeople(projectId: string, emails: string[]): Promise<ModuleHostPerson[]>
  /**
   * Start a run in one project with this prompt, with the person's own picks (which tool, which
   * model, where it runs), and land on it, unless `land` is false: then the dashboard stays where
   * it is, for a module that starts several runs in a row. Answers the run's id, or why there is none.
   */
  startRun(projectId: string, prompt: string, opts?: { land?: boolean }): Promise<StartRunResult>
  /** Open the project's launcher with this prompt drafted in, to set it up before sending: "Configure first, then run". */
  configureRun(projectId: string, prompt: string): void
  /**
   * The project's runs the dashboard knows: the ones running, and the recorded ones when the
   * project records them. `wanted` narrows them to the ones a card shows (those holding a claim,
   * the last 30 days): a project keeps hundreds, and a phone downloads every one asked for.
   */
  agents(projectId: string, wanted?: ModuleAgentsWanted): Promise<ModuleAgent[]>
  /**
   * The other computers a run can be sent to, as saved on this one, each with the OpenAgent it
   * runs, beside this computer's own: how a page tells that a machine fell behind this computer.
   */
  machines(): Promise<ModuleMachines>
  /**
   * Save the machine a link names: the link another OpenAgent gives for a new device, as a person
   * pastes it under Devices. This computer is let in there with it, once, and keeps its key.
   */
  addMachine(link: string, label?: string): Promise<MachineAdded>
  /**
   * Take a saved machine off the list, by its id, and this computer out of the machine: its key
   * there stops working. Refused, with the reason, while a run is at work there.
   */
  removeMachine(id: string): Promise<MachineRemoved>
  /** Give a saved machine the name the person picked: the machine keeps it as its own, and every page reads it from there. */
  renameMachine(id: string, label: string): Promise<MachineAdded>
  /** Give this computer the name the person picked: kept here, and every page reads it from here. */
  renameComputer(name: string): Promise<MachineAdded>
  /**
   * Have a saved machine save this computer, with the link this computer's door gave for a new
   * device: that machine then starts runs here too. Not for a computer reached through a server.
   */
  letMachineIn(machineId: string, link: string): Promise<MachineAdded>
  /**
   * A code one more device of the person's gets in with at a saved machine, a server: the link a
   * camera opens, and what is typed on another computer instead, where and the code. Works once,
   * until `expires`. Not for a computer reached through a server.
   */
  machineCode(machineId: string): Promise<ModuleMachineCode>
  /**
   * The computers that keep a line open to a saved server: computers at home a run can be sent to
   * through the server, and whether each is saved here already. None for a machine that is no server.
   */
  computersThrough(machineId: string): Promise<ModuleComputersThrough>
  /** Save one of them as a machine of its own, reached through the server: it is in "Run on" from then on. */
  addComputerThrough(machineId: string, computerId: string): Promise<MachineAdded>
  /**
   * What a saved machine's door says of the person this computer is in as there, on a computer
   * several people use: their GitHub account, whether they are its owner, and their devices. What
   * it said is another computer's data, to read as such; `unknown` for a machine that does not say.
   */
  machinePerson(machineId: string): Promise<ModuleMachinePerson>
  /**
   * A saved server of the person's uses this computer's logins from now on: each account this
   * computer is logged in to gets a login of the server's own there, as the Permissions page says.
   */
  useLoginsOn(machineId: string): Promise<MachineAdded>
  /** A saved server of the person's syncs its agent data with the repository this computer's does, sent as the login copied there. */
  syncDataOn(machineId: string): Promise<MachineAdded>
  /** The repository this computer's agent data syncs with, as a person reads it (`github.com/you/agent`); nothing when it syncs with none. */
  agentDataRemote(): Promise<string | undefined>
  /**
   * A coding agent's accounts on a saved machine, in the order its runs take them, as it says.
   * `null` for a machine that does not answer, or runs an OpenAgent that is not asked this.
   */
  machineAccounts(machineId: string, agent: ModuleAccountsAgent): Promise<ModuleMachineAccount[] | null>
  /**
   * Take one of them off the machine, by its id there, as its own page does: its runs no longer use
   * it. One this computer handed the machine, this computer offers it again (the Permissions page).
   */
  removeMachineAccount(machineId: string, agent: ModuleAccountsAgent, id: string): Promise<MachineAdded>
  /** Take one of that person's devices out at the machine, by its id there; answers as {@link machinePerson} does, after. */
  removeMachineDevice(machineId: string, deviceId: string): Promise<ModuleMachinePerson>
  /**
   * What the live screen of a run shows, as the screen's own stream of bytes, until `signal` ends
   * it; nothing when the run has no live screen. OpenAgent asks the computer the run is on, which
   * may be another machine: the bytes are that computer's, to read as data and never to run.
   */
  watchScreen(projectId: string, agentId: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | undefined>
  /** Send the live screen of a run what the person did on it, as JSON; whether the screen took it. */
  sendToScreen(projectId: string, agentId: string, input: unknown): Promise<boolean>
}

/** A coding agent whose accounts a page reads: Claude Code's, or Codex's. */
export type ModuleAccountsAgent = 'claude' | 'codex'

/** One of a coding agent's accounts on a saved machine, as {@link ModuleHost.machineAccounts} answers it. */
export interface ModuleMachineAccount {
  /** Its id there: what {@link ModuleHost.removeMachineAccount} takes. */
  id: string
  name: string
  /** The machine's own login, which Claude Code or Codex keeps there: not removed from here. */
  own: boolean
  /** The computer of the person's it came from, for one that computer handed over. */
  from?: string
  /** Runs there take it first. */
  first: boolean
}

/** A person of a project, as its git host knows them. */
export interface ModuleHostPerson {
  email: string
  login: string
  /** A picture of them: an https address. */
  avatar?: string
}

/** A saved machine, as a module sees it: never this computer's key there. */
export interface ModuleMachine {
  /** Where the machine answers, as an origin (`https://203.0.113.5`): what it is known by. */
  id: string
  label: string
  url: string
  /** The OpenAgent it runs; absent for a machine that does not answer right now. */
  version?: string
  /** How it stands, as it says: its memory, disk and load; absent for one that does not answer, or does not say. */
  health?: Health
  /** The id the machine lists this computer under, among the devices that are in there. */
  device?: string
  /** Whose computer it is, by their GitHub account, when it is another person's shared with everyone on a server. */
  owner?: string
  /**
   * The ids the machine is listed under at the doors of the machines it saved, as it says: one of
   * them among this computer's own door's devices is that machine, in there too.
   */
  listed?: string[]
}

/** What {@link ModuleHost.machines} answers. */
export interface ModuleMachines {
  /** This computer's own OpenAgent. */
  version: string
  /** This computer's own name, as another machine lists it: "Suleimans-MacBook-Pro". */
  name?: string
  /** Whether the person at the page names this computer: its owner, never a person the owner invited. */
  renames?: boolean
  /** How this computer stands: its memory, disk and load. */
  health?: Health
  machines: ModuleMachine[]
}

/** How saving a machine went: done, or stopped, with the reason. */
export type MachineAdded = { ok: true } | { ok: false; error: string }

/** A code a device gets in with at a saved machine, as {@link ModuleHost.machineCode} answers it. */
export type ModuleMachineCode = { ok: true; value: { url: string; where: string; code: string; expires: string } } | { ok: false; error: string }

/** A computer that keeps a line open to a saved server, as {@link ModuleHost.computersThrough} answers it. */
export interface ModuleComputerThrough {
  /** The server's id for it. */
  id: string
  name: string
  /** Its line is open right now. */
  online: boolean
  /** It is saved here, through the server. */
  added: boolean
  /** Whose computer it is, when it is another person's that keeps its line there for everyone. */
  owner?: string
}

/** What {@link ModuleHost.computersThrough} answers. */
export type ModuleComputersThrough = { ok: true; computers: ModuleComputerThrough[] } | { ok: false; error: string }

/** What {@link ModuleHost.machinePerson} answers: what the machine's door said, or why there is nothing. */
export type ModuleMachinePerson = { ok: true; said: unknown } | { ok: false; error: string; unknown?: true }

/** How removing a machine went: done, or refused, with the reason. */
export type MachineRemoved = { ok: true } | { ok: false; error: string }

/** What the dashboard knows about the module it is serving: every service but the commands and the reads, which it binds to the package. */
export type ModuleHostBase = Omit<ModuleHost, 'runCommand' | 'act' | 'runComputerCommand' | 'runComputerCommandOn' | 'call' | 'callComputer'>

/**
 * The host for one module: the dashboard's services, and its commands bound to the module's own
 * package. `acts` marks every command as an action on the project rather than a page's read: the
 * dashboard builds a link action's host with it, so what the action wrote is read back at once.
 */
export function moduleHost(base: ModuleHostBase, opts: { acts?: boolean } = {}): ModuleHost {
  return {
    ...base,
    runCommand: (projectId, args, command) => runModuleCommand(projectId, base.package, args, command, opts.acts ?? false),
    act: (projectId, args, command, input) => runModuleCommand(projectId, base.package, args, command, true, input),
    runComputerCommand: (args, command, input) => runComputerCommand(base.package, args, command, input),
    runComputerCommandOn: (machineId, args, command) => runComputerCommandOn(base.package, machineId, args, command),
    call: (projectId, name, input) => callModule(base.package, name, projectId, input),
    callComputer: (name, input) => callModule(base.package, name, null, input),
  }
}

/**
 * The client of the module's own server part, typed by its file:
 * `rpcClient<typeof import('../src/server.js')>(host)`. Each of the file's functions, called in a
 * project with its input, answers what the function answers, and throws why when the call fails,
 * so a polled read keeps the last answer it had.
 */
export function rpcClient<Server>(host: Pick<ModuleHost, 'call'>): RpcClient<Server> {
  return clientOf<RpcClient<Server>, [projectId: string, input: object]>((name, projectId, input) => host.call(projectId, name, input))
}

/**
 * The same for a package that is this computer's, whose functions are called in no project:
 * `computerRpcClient<typeof import('../src/server.js')>(host)`, each function with its input alone.
 */
export function computerRpcClient<Server>(host: Pick<ModuleHost, 'callComputer'>): ComputerRpcClient<Server> {
  return clientOf<ComputerRpcClient<Server>, [input: object]>((name, input) => host.callComputer(name, input))
}

function clientOf<Client extends object, Args extends unknown[]>(call: (name: string, ...args: Args) => Promise<ModuleCallResult>): Client {
  const functions = new Map<string, (...args: Args) => Promise<unknown>>()
  return new Proxy({} as Client, {
    get(_target, name) {
      // Never a promise: a client handed on through `await` is the client, not a call of `then`.
      if (typeof name !== 'string' || name === 'then') return undefined
      let fn = functions.get(name)
      if (!fn) {
        fn = async (...args) => {
          const result = await call(name, ...args)
          if (!result.ok) throw new Error(result.error)
          return result.output
        }
        functions.set(name, fn)
      }
      return fn
    },
  })
}

/** Set by the dashboard around every module piece it renders, with the module's whole host; a test of a module page provides one here. */
export const ModuleHostContext = createContext<ModuleHost | null>(null)

/** The dashboard's services for the module being rendered. Only valid inside a module page. */
export function useModuleHost(): ModuleHost {
  const host = useContext(ModuleHostContext)
  if (!host) throw new Error('useModuleHost is only available inside a module page')
  return host
}

/** Whether OpenAgent is not answering right now, as the page's banner says: a press that starts a run is off while it is true. */
export function useOpenAgentDown(): boolean {
  return useContext(DaemonDown)
}

// The dashboard's own building blocks, so a module looks like the rest of the page.
export { Button, buttonVariants, type ButtonProps } from '../components/ui/button.js'
export { CopyButton } from '../components/ui/copy-button.js'
export { Card, CardHeader, CardTitle, CardContent, PageLink } from '../components/ui/card.js'
export { Skeleton, useSkeleton } from '../components/ui/skeleton.js'
export { Slot, PanelShape, RowShapes, SentenceShape, WordsShape, type SlotRead } from '../components/ui/slot.js'
export { PartDescription } from '../components/PartDescription.js'
export { Input } from '../components/ui/input.js'
export { GaugeFace } from '../components/ui/gauge.js'
export { ClaudeLogo, CodexLogo } from '../components/driver-logos.js'
export { cn } from '../lib/utils.js'
export { inPlace } from '../lib/in-place.js'
export { runWord, runSaid, runTone, runLineTone } from '../lib/run-words.js'
export { RunMark } from '../components/RunMark.js'
export { usePolled, useLoaded, useAskOn, forgetRemembered, type ReadState } from '../lib/use-async.js'
export { useSpendOffset } from '../components/Quota.js'
/** For a read of runs: read again the moment the runs of a project (of every one, `undefined`) change, as the dashboard's own lists are. */
export { runsAgain } from '../lib/runs-changed.js'
export { useKeptDraft } from '../lib/draft-handoff.js'
export { FadeWhileStale } from '../components/FadeWhileStale.js'
export { Badge } from '../components/ui/badge.js'
export { Checkbox } from '../components/ui/checkbox.js'
export { Switch } from '../components/ui/switch.js'
export { Textarea } from '../components/ui/textarea.js'
export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js'
export { Label } from '../components/ui/label.js'
export { RadioGroup, RadioGroupItem, RadioGroupOption } from '../components/ui/radio-group.js'
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.js'
export { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js'
export { RangeSlider } from '../components/ui/slider.js'
export { Separator } from '../components/ui/separator.js'
export { DiffStat } from '../components/DiffStat.js'
export { ScrollArea } from '../components/ui/scroll-area.js'
export { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip.js'
export { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js'
export { ContextMenu, ContextMenuTrigger } from '../components/ui/context-menu.js'
export { PaneTitle, PaneActions } from '../components/PaneHeader.js'
export { Page, PageColumn, PagePresses } from '../components/Page.js'
export { Section } from '../components/ui/section.js'
export { List, Row } from '../components/ui/list.js'
export { Facts, Panel, PanelGroup, PanelGroups, PanelMore, PanelNote, PanelRow, StepNumber, type Fact } from '../components/ui/panel.js'
export { PriorityBadge, StateCell, StatePill, type WorkState } from '../components/ui/state.js'
export { Stepper } from '../components/ui/stepper.js'
export { ComposedField, ComposedFieldFoot, ComposedFieldInput } from '../components/ui/composed-field.js'
export { Empty } from '../components/ui/empty.js'
export { ShowSidebarButton } from '../components/SidebarToggle.js'
export { LinePart, counted } from '../components/LinePart.js'
export { FilterChips, type FilterChip } from '../components/FilterChips.js'
export { FileIcon } from '../components/FileIcon.js'
export { MiddleCut, PathCut } from '../components/MiddleCut.js'
export { treeRow } from '../components/tree-row.js'
export { PaneNote } from '../components/PaneNote.js'
export { Markdown, FileLinks } from '../components/Markdown.js'
export { StartAgentButton, StartAgentPress, type StartMenuItem } from '../components/StartAgentButton.js'
export { UpdateTicketsButton } from '../components/UpdateTicketsButton.js'
export { ButtonGroup, ButtonGroupSeparator } from '../components/ui/button-group.js'
export { LinkActions, useLinkActions, type LinkActionOffer, type ProjectLinks, type LinkTargets } from '../components/LinkActions.js'
export { MachineMark } from '../components/MachineMark.js'
export { PersonMark, personName } from '../components/PersonMark.js'
export { needsWord } from '../components/HumanQueueList.js'
export { useGitHostPeople, personSaid } from '../lib/use-git-host-people.js'
export { machineKind, machineName, runName, type MachineKind } from '../../src/client.js'
export { SettingsFoot, SettingsItem, SettingsItems, SettingsSection, SettingsRow, SettingsRowShapes, SettingsSelectRow, type SettingsOption } from '../components/SettingsRows.js'
export { Avatar } from '../components/PersonMenu.js'
export { usePerson, personChanged } from '../lib/use-person.js'
export { useSettingsCrumb, type SettingsCrumb } from '../lib/settings-crumb.js'
export { useSettingsHold } from '../lib/settings-hold.js'
export { QrCode } from '../components/QrCode.js'
export { Dialog } from '../components/ui/dialog.js'
export { reachedByLine } from '../../src/client.js'
export { useCodingAgents, type CodingAgent } from '../lib/models.js'
export { MAX_SPEND_OFFSET } from '../../src/preference-defaults.js'
export { formatRelative, formatDateTime, formatDuration, formatAge } from '../lib/format-date.js'
export { useNarrow } from '../lib/use-narrow.js'
export { useIsMobile } from '../lib/use-mobile.js'
export { Waiting } from '../components/Waiting.js'
export { useHighlighted, Pieces, type Piece } from '../lib/highlight.js'
export { useAction } from '../lib/use-action.js'
export { useSchedule, type Schedule } from '../lib/use-schedule.js'
export { useFileNames, pathsIn, type FileNames, type NamedFile } from '../lib/use-file-names.js'
export { ConfirmDialog } from '../components/ui/confirm-dialog.js'
export { overlayOpen } from '../lib/shortcut.js'
