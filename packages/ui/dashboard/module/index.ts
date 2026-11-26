// `@openagt/ui/module`: what the dashboard offers a module (#1774).
//
// A module is a package that adds to the dashboard; its browser part is the file it exports as
// `./dashboard`. The dashboard finds it among the distribution's packages (#2394), imports it at
// runtime, and reads its default export, a
// `UiModuleDefinition`: the UI hooks it fills, each at a place of the shell's, as `@openagt/hooks/ui`
// declares them and this file offers them, beside the shell's host and its design kit (#2394). The
// browser part imports `react` and this file as bare names and bundles neither: the dashboard's
// import map points both at the dashboard's own running copies, so a module renders inside the same
// React tree and uses the same components as the rest of the page.
//
// This file IS `@openagt/ui/module`: the dashboard's build emits it as its own entry (`/assets/host/module-<hash>.js`),
// sharing every chunk with the dashboard itself. Nothing here names a skill.
import { createContext, useContext } from 'react'
import type { Activity as ActivityItem, AgentStatus, ProjectionRead, Waiting as WaitingItem } from '../../src/index.js'
import type { ModuleAgent, ModuleAgentsWanted } from '../../src/dashboard/module-agents.js'
import { callModule, runComputerCommand, runModuleCommand, type ModuleCallResult, type ModuleCommandResult } from '../rpc/modules.js'
import type { ComputerRpcClient, RpcClient } from '@openagt/hooks/rpc'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { SESSIONS_ID } from '../../src/project-address.js'

export type { ModuleCallResult, ModuleCommandResult, ActivityItem, AgentStatus, ModuleAgent, ModuleAgentsWanted, ProjectionRead, WaitingItem }
export type * from '@openagt/hooks/ui'
export { defineUiModule } from '@openagt/hooks/ui'

/**
 * The project a module's server part is called in where its box has no project of its own: a
 * session with no project, and a profile's editor, which is for any project. Its host's project is
 * none there, and its folder is no project's.
 */
export const NO_PROJECT = SESSIONS_ID

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
   * change shows at once instead of at the next sync.
   * `input` is what the command reads on standard input: a whole file it writes, a ticket say.
   */
  act(projectId: string, args: string[], command?: string, input?: string): Promise<ModuleCommandResult>
  /**
   * Run one of the module package's own commands in no project, for a package that is this
   * computer's (its accounts, say): what such a package keeps is the computer's, so its page reads
   * and changes it with no project added. Refused for any other
   * package. `input` is what the command reads on standard input: a secret, which no other
   * program on this computer sees there, as it would among the arguments.
   */
  runComputerCommand(args: string[], command?: string, input?: string): Promise<ModuleCommandResult>
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
   * Open an entry of Settings over the page, by its id: `openSettings('skills')`; with `item`, at
   * that page inside it. From inside Settings, it moves to that entry in place: Back and closing
   * still go to the page under it.
   */
  openSettings(entry: string, item?: string): void
  /**
   * The accounts behind a project's commit emails at its git host, each with its login and picture:
   * an email the host knows nobody for, or a project with no git host, is left out. Kept a day.
   */
  people(projectId: string, emails: string[]): Promise<ModuleHostPerson[]>
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
   * the last 30 days): a project keeps hundreds, and the page reads every one asked for.
   */
  agents(projectId: string, wanted?: ModuleAgentsWanted): Promise<ModuleAgent[]>
  /**
   * The runs that started or ended lately, in every project of this computer's, with the projects
   * the read reached whole: what a part that tells of activity compares.
   */
  activity(): Promise<ProjectionRead<ActivityItem>>
  /**
   * What the live screen of a run shows, as the screen's own stream of bytes, until `signal` ends
   * it; nothing when the run has no live screen. The bytes are the screen's, to read as data and
   * never to run.
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

/** What the dashboard knows about the module it is serving: every service but the commands and the reads, which it binds to the package. */
export type ModuleHostBase = Omit<ModuleHost, 'runCommand' | 'act' | 'runComputerCommand' | 'call' | 'callComputer'>

/** The host for one module: the dashboard's services, and its commands bound to the module's own package. */
export function moduleHost(base: ModuleHostBase): ModuleHost {
  return {
    ...base,
    runCommand: (projectId, args, command) => runModuleCommand(projectId, base.package, args, command, false),
    act: (projectId, args, command, input) => runModuleCommand(projectId, base.package, args, command, true, input),
    runComputerCommand: (args, command, input) => runComputerCommand(base.package, args, command, input),
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
export { Card, CardHeader, CardTitle, CardContent, HEADING_PRESS_CLASS, PageLink } from '../components/ui/card.js'
export { Skeleton, useSkeleton } from '../components/ui/skeleton.js'
export { Slot, PanelShape, RowShapes, SentenceShape, WordsShape, type SlotRead } from '../components/ui/slot.js'
export { PartDescription } from '../components/PartDescription.js'
export { Input } from '../components/ui/input.js'
export { GaugeFace } from '../components/ui/gauge.js'
export { cn } from '../lib/utils.js'
export { PR_MARKS, prStateOf, type PrState } from '../lib/pr-marks.js'
export { inPlace } from '../lib/in-place.js'
export { runWord, runSaid, runTone, runLineTone, runState } from '../lib/run-words.js'
// What a waiting item needs, as its colour says it in every list of what waits (Overview, sidebar, Logs).
export { waitingTone } from '../components/WaitingList.js'
export { RunMark } from '../components/RunMark.js'
export { usePolled, useLoaded, useAskOn, forgetRemembered, type ReadState } from '../lib/use-async.js'
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
// A radio drawn as the module draws it (a whole row the radio): the same Base UI as the group's, so the group finds it.
export { Radio } from '@base-ui/react/radio'
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.js'
export { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js'
export { RangeSlider } from '../components/ui/slider.js'
export { Separator } from '../components/ui/separator.js'
export { DiffStat } from '../components/DiffStat.js'
export { ScrollArea } from '../components/ui/scroll-area.js'
export { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip.js'
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  MenuMark,
  MENU_BODY_CLASS,
  MENU_ITEM_CLASS,
  MENU_POPUP_CLASS,
  MENU_TRIGGER_OPEN_CLASS,
  PICKER_SEARCH_CLASS,
} from '../components/ui/dropdown-menu.js'
// A searchable list in a popup, drawn as the module draws it: the same Base UI as the dashboard's pickers.
export { Combobox } from '@base-ui/react/combobox'
export { usePickerSearch } from '../components/ui/picker-search.js'
export { POPUP_EDGE, usePopupPosition } from '../components/ui/popup-placement.js'
export { PROJECT_ROW_CLASS } from '../components/ui/nav-row.js'
export { OptionLabel } from '../components/ui/option-label.js'
// The message box's rows, as a control there draws its item (`composer.control`).
export { rowButtonClass, rowItemClass, RowChevron, RowSaid, RowItem, BoxOfRow } from '../components/ui/row-item.js'
// A line of the gear's menu under the message box (`composer.control` at `setup`).
export { PICK_CLASS as SETUP_PICK_CLASS, SetupLine, SetupPress, SetupRow, SetupRows, SetupSaid, useSetupRows } from '../components/SessionSetup.js'
// The places a module draws itself: a profile's editor draws every control of the message box, the usage card the usage bar's line.
export { ComposerControls, HandoffOffers, ViewsAt, useViewsAt, useControlsSaid, useOptionsAt, type ControlBox, type ControlsSaid } from '../components/Places.js'
export { ModuleSlot } from '../components/ModulePageView.js'
// A row of the panel of a session's work above its message box (`chat.work`): a repo's name, its branch, what it holds, its next steps.
export { WorkRow } from '../components/WorkRow.js'
export { EnvironmentRow, prTone, repoPath } from '../components/EnvironmentRow.js'
/** For a read of what a pick for every next run decides (the profile picked under the box): read again the moment one is saved, which its control tells. */
export { nextRunAgain, tellNextRunPicked } from '../lib/next-run-picked.js'
/** Keep the page's entry while something typed would be lost by leaving it: Back asks first, and so does the browser on a reload. */
export { holdEntry } from '../lib/use-route.js'
// The projects the shell lists, and the word a module that changes the list sends it (the projects module's).
export { useProjects, projectsChanged, type ProjectsChange } from '../lib/shell-projects.js'
export { useProjectLabel } from '../lib/project-labels.js'
export type { ProjectSummary } from '../../src/dashboard/projects.js'
export { inWords } from '../lib/in-words.js'
export { formatBytes } from '../../src/format-bytes.js'
/** For a read of what the plugins give: read again the moment a plugin is switched in Settings. */
export { pluginsAgain } from '../lib/plugins-switched.js'
export { ContextMenu, ContextMenuTrigger } from '../components/ui/context-menu.js'
export { PaneTitle, PaneActions } from '../components/PaneHeader.js'
export { Page, PageColumn, PagePresses } from '../components/Page.js'
export { Section } from '../components/ui/section.js'
export { List, Row } from '../components/ui/list.js'
export { EmptyNote, Facts, Panel, PanelGroup, PanelGroups, PanelMore, PanelNote, PanelRow, StepNumber, type Fact } from '../components/ui/panel.js'
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
export { Markdown, InlineMarkdown, ModuleBlock } from '../components/Markdown.js'
export { FileLinks, IssueLinks } from '../lib/markdown-links.js'
export { wordShownAt } from '../lib/use-steady-text.js'
export { StartAgentButton, StartAgentPress, type StartMenuItem } from '../components/StartAgentButton.js'
export { ButtonGroup, ButtonGroupSeparator } from '../components/ui/button-group.js'
export { LinkActions, useLinkActions, type LinkActionOffer, type ProjectLinks, type LinkTargets } from '../components/LinkActions.js'
export { PersonMark, personName } from '../components/PersonMark.js'
export { waitingKey } from '../../src/client.js'
export { WaitingList, holdsBack } from '../components/WaitingList.js'
export { useWaiting, type WaitingRead } from '../lib/use-waiting.js'
export { usePeople, personSaid } from '../lib/use-people.js'
export { runName } from '../../src/client.js'
export { SettingsFoot, SettingsItem, SettingsItems, SettingsSection, SettingsRow, SettingsRowShapes, SettingsSelectRow, ToggleRow, type SettingsOption } from '../components/SettingsRows.js'
export { Avatar } from '../components/PersonMenu.js'
export { usePerson, personChanged } from '../lib/use-person.js'
export { CommandLine, FixAction, Linked, PackageLogo, type FixVariant } from '../components/Logins.js'
// A "Send as" select of OpenAgent's accounts at a host (`RpcHost.accounts`).
export { SendAs, firstSendAs } from '../components/SendAs.js'
export { ModuleFixPress } from '../components/Attention.js'
export { PathStrip } from '../components/PathStrip.js'

export { Dialog, BACKDROP_CLASS, DIALOG_POPUP_CLASS, DIALOG_PRESSES_CLASS } from '../components/ui/dialog.js'
// A question that is a dialog of its own, drawn as the module draws it: the same Base UI as the dashboard's confirmations.
export { AlertDialog } from '@base-ui/react/alert-dialog'
export { useCodingAgents, type CodingAgent } from '../lib/agents.js'
export { effortLabel } from '../lib/effort.js'
export { FocusHome } from '../lib/focus-home.js'
export { MAX_SPEND_OFFSET } from '@openagt/hooks/ui'
export { formatRelative, formatDateTime, formatDuration, formatDurationLong, formatAge, formatDay, formatResetDay, formatResetTooltip } from '../lib/format-date.js'
export { useNarrow } from '../lib/use-narrow.js'
export { useIsMobile, isMobileScreen } from '../lib/use-mobile.js'
export { Waiting } from '../components/Waiting.js'
// A question as the chat draws it: the card of the module that asks, where it is on, else in words.
export { AskedQuestion } from '../components/AskedQuestion.js'
export { useHighlighted, useHighlightedIn, languageOfFence, Pieces, ColouredLines, type Piece } from '../lib/highlight.js'
export { useAction } from '../lib/use-action.js'
// OpenAgent did not answer, as against a refusal: a read that meets it lets it through, so it keeps what it showed and asks again.
export { isUnreachable } from '../lib/rpc.js'
export { useFileNames, pathsIn, type FileNames, type NamedFile } from '../lib/use-file-names.js'
export { ConfirmDialog } from '../components/ui/confirm-dialog.js'
// The dashboard's keys, as its keyboard shortcuts list names them: a module's are the same.
export { overlayOpen, MOD_KEY, pressed, typedInto, type ShortcutId } from '../lib/shortcut.js'
