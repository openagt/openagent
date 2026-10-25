// `@openagt/dashboard/module`: what the dashboard offers a module (#1774).
//
// A module is a package that adds to the dashboard; its browser part is the file it exports as
// `./dashboard`. The dashboard finds it in a
// project's dependencies, imports it at runtime, and reads its default export, a
// `ModuleDefinition`. The browser part imports `react` and this file as bare names and bundles
// neither: the dashboard's import map points both at the dashboard's own running copies, so a
// module renders inside the same React tree and uses the same components as the rest of the page.
//
// This file IS `@openagt/dashboard/module`: the dashboard's build emits it as its own entry (`/host/module.js`),
// sharing every chunk with the dashboard itself. Nothing here names a skill.
import type { Health } from '../../src/health.js'
import type { CardWidth } from '../../src/overview-layout.js'
import { createContext, useContext, useMemo, type ComponentType } from 'react'
import type { AgentStatus } from '../../src/index.js'
import { readModule, runComputerCommand, runComputerCommandOn, runModuleCommand } from '../rpc/modules.js'
import type { ModuleCommandResult, ModuleReadResult } from '../rpc/modules.js'

export type { ModuleCommandResult, ModuleReadResult, AgentStatus, CardWidth, Health }

/** A registered project that has the module's package, as a page gets it. */
export interface ModuleProject {
  id: string
  name: string
  /** Whether one of the project's packages provides a git host; without one no pull request can be opened there. */
  gitHost: boolean
}

/**
 * What a module page is rendered with. A page reads its sub-path and navigates within itself
 * through {@link ModuleHost.openPage}; the dashboard's own pages reach it the same way, by the
 * link convention below.
 *
 * A link into a project's files (`ModuleLink.href` such as `tickets/2026-01-01_x.md`) opens the
 * mounted page named by its first segment in that project, at `/<project>/<segment>/<rest…>`: the
 * page gets `projectId` and `rest` as its path. So a page that shows one project's file under its
 * own segment is where every such link in the dashboard lands, and the dashboard names no page.
 */
export interface ModulePageProps {
  /** The registered projects whose dependencies include the module's package, in the registry's order: only the picked one when one is. */
  projects: ModuleProject[]
  /** The project the address starts with (`/<project>/<segment>`), picked in the sidebar; null when every project shows. */
  projectId: string | null
  /** The URL's segments after the page's own, decoded: `/logs/a` gives `['a']`. */
  path: string[]
}

/** A page a module adds: its own URL segment and its row in the sidebar. */
export interface ModulePage {
  /** The page's URL, `/<segment>`, and `/<project>/<segment>` with a project picked: a lowercase letter, then lowercase letters and digits, never `overview` or `settings`. A project named as a page's word is addressed by its id. */
  segment: string
  /** The sidebar row's label. */
  label: string
  /** The sidebar row's icon; a generic one when absent. */
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** The page itself. */
  Page: ComponentType<ModulePageProps>
  /**
   * What the paths into a project's files that this page opens are called: asked by other pages
   * that show such a path (a queue entry that names `tickets/2026-01-01_x.md`), so they can show
   * a name a person reads in place of a file path. Given the paths whose first segment is the
   * page's own; answers the ones it can name, by path. Read through {@link useFileNames}.
   */
  names?(host: ModuleHost, projectId: string, paths: string[]): Promise<Record<string, ModuleFileName>>
}

/** What a path into a project's files is called, as the page that opens it says. */
export interface ModuleFileName {
  /** The name a person reads: a ticket's title. */
  title: string
  /** The path that is opened for it, when it is not the path asked about: a plan still to be written opens its ticket. */
  href?: string
}

/**
 * A link a dashboard page shows (#1774): the name of some work and where it points. What a
 * {@link LinkAction} is given. The dashboard knows nothing of what the link names; the page that
 * shows it does, and says so in these three fields.
 */
export interface ModuleLink {
  /** The link's text: the name of the work. */
  text: string
  /**
   * Where the link points: a path inside the project's repository (`tickets/2026-01-01_x.md`) or an
   * absolute URL. Absent for plain text that names work without pointing anywhere.
   */
  href?: string
  /** How urgent the page says the work is, 0 (only if capacity) to 10 (critical); absent when the page does not say. */
  priority?: number
}

/** What a link action did: done, or stopped, with the reason the action or its command gave. */
export type LinkActionResult = { ok: true } | { ok: false; error: string }

/**
 * An action a module offers on the links dashboard pages show (#1774): one verb, done by the
 * module package's own command. The dashboard shows it as a button beside any link whose project
 * has the module's package, with no page naming the module: the page shows links, the module acts
 * on links, the dashboard puts the two together.
 */
export interface LinkAction {
  /** The button's label, a short verb phrase: "Add to queue". */
  label: string
  /** What the button says once the action is done: "Queued". The label with a check mark otherwise. */
  doneLabel?: string
  /** The button's icon; none otherwise. */
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /**
   * Act on the links, in the order given, all in one project. `host` runs the module package's
   * own commands in that project. A batch stops at its first failure and says why.
   */
  run(host: ModuleHost, projectId: string, links: ModuleLink[]): Promise<LinkActionResult>
}

/** What a module card is rendered with: the projects that have its package, never none: the card is not drawn then. With a project picked in the dashboard, that project alone. A card has no URL and no sub-path. */
export interface ModuleCardProps {
  /** The registered projects that have the module's package, in the registry's order; with a project picked in the dashboard, that project alone. Never empty. */
  projects: ModuleProject[]
}

/**
 * A card a module adds to the Overview (#1818): the package's own summary of its data across the
 * projects that have it, drawn beside the dashboard's own cards. Drawn only when one of the
 * projects the Overview shows has the package: with a project picked, only when that project has it.
 */
export interface ModuleCard {
  /** Which card this is, for the shell's key and its error line; never shown as a title. */
  id: string
  /** Its name where the person arranges the Overview's cards: what its title says ("Hot tickets"). */
  label: string
  /** How wide it stands until the person picks: half the Overview when unsaid. */
  width?: CardWidth
  /** The narrowest it fits: a third of the Overview when unsaid. */
  minWidth?: CardWidth
  /** Its place among every installed package's cards, lower first; 50 when unsaid, ties by package name. */
  order?: number
  /** The card itself. */
  Card: ComponentType<ModuleCardProps>
}

/** What a Settings section is rendered with: the projects whose settings it shows and saves. */
export interface ModuleSettingsProps {
  /**
   * The projects the section is for, in the registry's order: the one picked in Settings, or every
   * project that has the package when "All projects" is picked; none for a package that is the
   * computer's. A save goes to each of them.
   */
  projects: ModuleProject[]
}

/**
 * An entry a module adds to Settings: the package's own settings, read and written through its
 * own command. Settings lists it with the dashboard's own entries and draws its title and icon
 * there. A package that is the computer's is listed under "You and this computer"; any other
 * under the project picked in Settings, when that project has the package.
 */
export interface ModuleSettings {
  /** Which entry this is: the shell's key, and its name in the address (`?settings=<id>`). */
  id: string
  /** The entry's name in the list and over its settings. */
  title: string
  /** The entry's icon in the list. */
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** Its place among every installed package's entries, lower first; 50 when unsaid, ties by package name. */
  order?: number
  /** The settings themselves, a {@link SettingsSection} of rows. */
  Section: ComponentType<ModuleSettingsProps>
}

/** How saving a usage limit went: done, or stopped, with the reason the module's command gave. */
export type UsageLimitSaved = { ok: true } | { ok: false; error: string }

/**
 * The stop line a module puts on the Overview's usage bar: where its unattended work stops, as an
 * offset from the quota boundary in percentage points, negative before it and positive past it.
 * The bar draws the line and its handle, and asks the module to read the offset and to save the
 * one a drag picked, through the module package's own command. The first module that declares one
 * (in package order) has the line.
 */
export interface ModuleUsageLimit {
  /** The offset in force across the projects, or undefined when none says one: the bar then draws no line. */
  read(host: ModuleHost, projects: ModuleProject[]): Promise<number | undefined>
  /** Save the offset the handle was dragged to, within ±{@link MAX_SPEND_OFFSET}. */
  save(host: ModuleHost, projects: ModuleProject[], points: number): Promise<UsageLimitSaved>
}

/** A command that starts by itself in a project, as the module that schedules it says it. */
export interface ModuleScheduledCommand {
  /** The command as a person types it, without its slash: `work-queue`. */
  command: string
  /** Whether it starts by itself on this computer right now. */
  on: boolean
  /** One line on it, for a person: when it starts next while it is on ("Next start in 3h, if there is work"), or why it does not start though its own switch is on ("The scheduler is off", "Cannot start on Codex: …"). */
  note?: string
}

/**
 * What a module that starts commands by itself tells the other pages: which commands, and whether
 * each is on. A page whose work such a command takes (a queue) says so with it, and links to the
 * module's own page, where a person switches a command on. The first module that declares one
 * (in package order) is asked. Read through {@link useSchedule}.
 */
export interface ModuleSchedule {
  /** The module's own page where a person switches a command on, by its segment. */
  page: string
  /** One project's commands that can start by themselves. Rejects when they cannot be read: the page then says nothing of that project. */
  read(host: ModuleHost, project: ModuleProject): Promise<ModuleScheduledCommand[]>
}

/**
 * The Context as a pane sees it (#504): the files the next run is pointed at. A pane may
 * show which files are in it and add or remove one.
 */
export interface ModuleContext {
  /** The Context's files, as repo-relative paths. */
  files: ReadonlySet<string>
  /** Add the path to the Context, or take it out when it is in. */
  toggle(path: string): void
}

/** What a pane is rendered with: the project on screen, the run selected in it (if any), the Context. */
export interface ModulePanelProps {
  projectId: string
  /** The run whose page this is; absent on the project's own page. */
  agentId?: string
  /**
   * How many events the run's feed has shown: it grows each time the agent does something, so a
   * pane showing what the agent changes reads again then, rather than on its next poll. Absent on
   * the project's own page.
   */
  activity?: number
  /**
   * On a pane that lists what a run changed (`changes`): the changed file a click in the chat
   * asked to see, by its path in the run's checkout; no path when the click asked for all of
   * them, from the first. `at` tells one ask from the next for the same file. Absent until a
   * file is asked for.
   */
  reveal?: { path?: string; at: number }
  context: ModuleContext
}

/**
 * A pane a module adds beside the chat (#492), on every project's page and every run's page of
 * the projects that have the module: an icon at the end of the page's top bar opens it, in a
 * column with the other open panes. A pane with nothing to show says so inside it: the top bar
 * cannot know a module is empty without rendering it.
 */
export interface ModulePanel {
  /** Which pane this is among the module's own, for its key and for remembering that it is open. */
  id: string
  /** The pane's name: on its card, and what its icon is called and its tooltip says. */
  label: string
  /** The pane's icon in the top bar, drawn at the size its `className` gives. */
  icon: ComponentType<{ className?: string }>
  /**
   * This pane lists what a run changed. The chat's row of a changed file then opens it, and
   * hands it the file as `reveal`. Without such a pane, those rows open nothing.
   */
  changes?: true
  /**
   * This pane shows a run's live screen ({@link ModuleHost.watchScreen}). The chat's row of a live
   * screen then opens it. Without such a pane, that row is a line of text.
   */
  screen?: true
  /** The pane's contents. They may put their own things in the card's header: {@link PaneTitle}, {@link PaneActions}. */
  Panel: ComponentType<ModulePanelProps>
}

/** What a run slot is rendered with: the run, and whether its agent is working. */
export interface ModuleRunProps {
  projectId: string
  agentId: string
  /** The run's agent is still working: a run that ended, or stopped on a question, is not. */
  working: boolean
}

/**
 * What a module adds to a run's page: `summary`, a few words in the bar above the message box,
 * shown until the run has ended and its branch has been read (the dashboard's own words about the
 * branch take over then).
 */
export interface ModuleRunSlots {
  summary?: ComponentType<ModuleRunProps>
}

/** What a module's browser part default-exports. */
export interface ModuleDefinition {
  /** The pages the module adds, each with a sidebar row. */
  pages?: ModulePage[]
  /** The cards the module adds to the Overview. */
  cards?: ModuleCard[]
  /** The actions the module offers on the links dashboard pages show, wherever the link's project has the module's package. */
  linkActions?: LinkAction[]
  /** The panes the module adds beside the chat. */
  panels?: ModulePanel[]
  /** What the module adds to a run's page. */
  run?: ModuleRunSlots
  /** The entries the module adds to Settings. */
  settings?: ModuleSettings[]
  /**
   * What the module draws over every page, for as long as the dashboard is open: nothing, until
   * something it watches asks for the person, such as another computer asking to connect. Drawn
   * once, with no project, and only for a module of this computer's.
   */
  everyPage?: ComponentType
  /** The stop line the module puts on the usage bar. */
  usageLimit?: ModuleUsageLimit
  /** The commands the module starts by itself, for the other pages to say. */
  schedule?: ModuleSchedule
  /** A stylesheet to load with the module, relative to the module's browser part's own URL. */
  stylesheet?: string
}

/** Type the default export: `export default defineModule({ ... })`. */
export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition
}

/** A run of a project as the dashboard knows it (#1774): enough for a page to name one and link to it. */
export interface ModuleAgent {
  /** The run's id, the one {@link ModuleHost.openAgent} takes. */
  id: string
  /** The run's branch, the name the agent gave its work, when its record carries one. */
  name?: string
  /** What the run was asked, as typed or as queued; absent when its record carries none. */
  ask?: string
  /** How it stands: `unknown` while the computer it runs on does not answer, whatever its record last said. */
  status: AgentStatus
  /** ISO 8601. */
  startedAt: string
  /** ISO 8601, once it ended. */
  endedAt?: string
  /** Its short name, as a list of runs shows it. */
  title?: string
  /** Whose run it is, by the email its record is kept under. */
  person?: string
  /** What it cost so far, in US dollars. */
  cost?: number
  /** The coding agent that runs it (`claude-code`, `codex`, …) and its model. */
  driver?: string
  model?: string
  /** The saved machine it runs on, by the name it was given; absent for a run of this computer's. */
  machine?: string
  /** While its status is `unknown`: when its computer was last seen, ISO, if it was. */
  seenAt?: string
}

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
   */
  act(projectId: string, args: string[], command?: string): Promise<ModuleCommandResult>
  /**
   * Run one of the module package's own commands in no project, for a package that is this
   * computer's (the door to it, its servers): what such a package keeps is the computer's, so
   * its page reads and changes it with no project added. Refused for any other package.
   * `input` is what the command reads on standard input: a secret, which no other program on
   * this computer sees there, as it would among the arguments.
   */
  runComputerCommand(args: string[], command?: string, input?: string): Promise<ModuleCommandResult>
  /**
   * The same, on a saved machine whose package of the same name is that computer's: what the
   * package keeps over there, read and changed with this computer's key there, as that machine's
   * own page would. Not for a computer reached through a server.
   */
  runComputerCommandOn(machineId: string, args: string[], command?: string): Promise<ModuleCommandResult>
  /**
   * Call one of the module's own server reads (its package's `./server`) in one project, with
   * `input`, a JSON object; `input.agentId` names the run the read is about, when it is about one.
   * Answered in the daemon's own process, so it suits a read made every few seconds.
   */
  read(projectId: string, name: string, input?: Record<string, unknown>): Promise<ModuleReadResult>
  /** Open one agent's page in the dashboard: its live feed while it runs, its record after. */
  openAgent(projectId: string, agentId: string): void
  /**
   * Open a page a module adds (this one's or another's), at a sub-path, in the project picked in
   * the dashboard, or in `projectId`, which is then the one picked: `openPage('tickets', [file], projectId)`.
   * A page the picked project's packages do not add shows "No such page".
   */
  openPage(segment: string, path?: string[], projectId?: string): void
  /** The address of a page a module adds, with the project picked in the dashboard: a link's `href`, for a link that also opens in a new tab. */
  pageHref(segment: string): string
  /** Open an entry of Settings over the page, by its id: `openSettings('devices')`. */
  openSettings(entry: string): void
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
  /** The project's runs the dashboard knows: the ones running, and the recorded ones when the project records them. */
  agents(projectId: string): Promise<ModuleAgent[]>
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
  /** Give a saved machine the name the person picked. */
  renameMachine(id: string, label: string): Promise<MachineAdded>
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
   * computer is logged in to gets a login of the server's own there, as Settings › Accounts says.
   */
  useLoginsOn(machineId: string): Promise<MachineAdded>
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
export type ModuleHostBase = Omit<ModuleHost, 'runCommand' | 'act' | 'runComputerCommand' | 'runComputerCommandOn' | 'read'>

/**
 * The host for one module: the dashboard's services, and its commands bound to the module's own
 * package. `acts` marks every command as an action on the project rather than a page's read: the
 * dashboard builds a link action's host with it, so what the action wrote is read back at once.
 */
export function moduleHost(base: ModuleHostBase, opts: { acts?: boolean } = {}): ModuleHost {
  return {
    ...base,
    runCommand: (projectId, args, command) => runModuleCommand(projectId, base.package, args, command, opts.acts ?? false),
    act: (projectId, args, command) => runModuleCommand(projectId, base.package, args, command, true),
    runComputerCommand: (args, command, input) => runComputerCommand(base.package, args, command, input),
    runComputerCommandOn: (machineId, args, command) => runComputerCommandOn(base.package, machineId, args, command),
    read: (projectId, name, input = {}) => readModule(projectId, base.package, name, input),
  }
}

/**
 * Set by the dashboard around every module page it renders: the module's package and the
 * dashboard's services. A test of a module page provides a whole host here, commands included,
 * and {@link useModuleHost} hands it over as it is.
 */
export const ModuleHostContext = createContext<ModuleHostBase | ModuleHost | null>(null)

/** The dashboard's services for the module being rendered. Only valid inside a module page. */
export function useModuleHost(): ModuleHost {
  const host = useContext(ModuleHostContext)
  // The same host from render to render, so an effect keyed on it does not start over.
  const bound = useMemo(() => (host && !('runCommand' in host) ? moduleHost(host) : undefined), [host])
  if (!host) throw new Error('useModuleHost is only available inside a module page')
  return bound ?? (host as ModuleHost)
}

// The dashboard's own building blocks, so a module looks like the rest of the page.
export { Button, buttonVariants, type ButtonProps } from '../components/ui/button.js'
export { Badge } from '../components/ui/badge.js'
export { Card, CardHeader, CardTitle, CardTitleLink, CardContent } from '../components/ui/card.js'
export { Skeleton } from '../components/ui/skeleton.js'
export { Checkbox } from '../components/ui/checkbox.js'
export { Switch } from '../components/ui/switch.js'
export { Input } from '../components/ui/input.js'
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
export { Page } from '../components/Page.js'
export { StatTile } from '../components/StatTile.js'
export { FilterChips, type FilterChip } from '../components/FilterChips.js'
export { FileIcon } from '../components/FileIcon.js'
export { Markdown } from '../components/Markdown.js'
export { StartAgentButton } from '../components/StartAgentButton.js'
export { LinkActions, type ProjectLinks, type LinkTargets } from '../components/LinkActions.js'
export { cn } from '../lib/utils.js'
export { SettingsSection, SettingsRow, SettingsSelectRow, type SettingsOption } from '../components/SettingsRows.js'
export { useSettingsCrumb, type SettingsCrumb } from '../lib/settings-crumb.js'
export { QrCode } from '../components/QrCode.js'
export { Dialog } from '../components/ui/dialog.js'
export { reachedByLine } from '../../src/client.js'
export { useCodingAgents, type CodingAgent } from '../lib/models.js'
export { MAX_SPEND_OFFSET } from '../../src/preference-defaults.js'
export { formatRelative, formatDateTime, formatDuration, formatAge } from '../lib/format-date.js'
export { usePolled, useLoaded, forgetRemembered } from '../lib/use-async.js'
export { useNarrow } from '../lib/use-narrow.js'
export { Waiting } from '../components/Waiting.js'
export { useHighlighted, Pieces, type Piece } from '../lib/highlight.js'
export { useAction } from '../lib/use-action.js'
export { useSchedule, type Schedule } from '../lib/use-schedule.js'
export { useFileNames, pathsIn, type FileNames, type NamedFile } from '../lib/use-file-names.js'
export { ConfirmDialog } from '../components/ui/confirm-dialog.js'
