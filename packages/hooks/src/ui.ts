// The UI hooks (#2394): what a module's UI part fills, each at one of the shell's places. A
// module's UI part is an entry of its package of its own (`./dashboard`), which the shell loads
// in the browser; its Node part's hooks are `./module`'s, so a run's process never loads React.
// Four hooks, each taking a place: a component at a place (`ui.view`), something to do at one
// (`ui.action`), something to pick in a shared menu (`ui.option`), and how a kind of content looks
// (`ui.render`). Each place's props are typed here, so a new place needs no new hook.
import type { ComponentType, ReactNode } from 'react'

/** An icon, drawn at the size its `className` gives. */
export type UiIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

/** A registered project that has the module, as a place is given it. */
export interface UiProject {
  id: string
  name: string
  /** Whether the project has a git host; without one no pull request can be opened there. */
  gitHost: boolean
}

/** What the shell does for an entry's functions, as a view gets it from the shell's `useModuleHost`: the module's own package's commands, run in a project. */
export interface UiHost {
  /** The module's package. */
  readonly package: string
  /** Run one of the package's commands in the project, its answer read as JSON; `command` names which, when the package has several. */
  runCommand(projectId: string, args: string[], command?: string): Promise<UiCommandResult>
}

/** What a command answered: its output read as JSON, or in words why there is none. */
export type UiCommandResult = { ok: true; output: unknown } | { ok: false; error: string }

/** How wide a card stands on the Overview: a share of its width. */
export type UiCardWidth = '1/4' | '1/3' | '1/2' | '2/3' | '3/4' | '1'

/** What a page is given: the projects that have the module, the project its address names, and the rest of its address. */
export interface UiPageProps {
  /** The registered projects that have the module, in the registry's order: only the picked one when one is. */
  projects: UiProject[]
  /** The project the address starts with (`/<project>/<segment>`), picked in the sidebar; null when every project shows. */
  projectId: string | null
  /** The address's segments after the page's own, decoded: `/logs/a` gives `['a']`. */
  path: string[]
}

/** What a path into a project's files is called, as the page that opens it says. */
export interface UiFileName {
  /** The name a person reads: a ticket's title. */
  title: string
  /** The path that is opened for it, when it is not the path asked about: a plan still to be written opens its ticket. */
  href?: string
  /**
   * The ask for what the path names, word for word, once it is there already: an entry saying just
   * this is left over (`Create tickets/<stem>.plan.md`, a plan already written), and is called
   * `title` ("Plan: Login page · already written"). Any other entry naming the path is still work.
   */
  done?: { ask: string; title: string }
}

/** A coding agent's account, as a card that lists them names it to {@link UiCardProps.accountWhere}. */
export interface UiAccount {
  agent: 'claude' | 'codex'
  /** The person's own login on this computer, not one added to OpenAgent. */
  own: boolean
  /** What the card's commands know it by. */
  name: string
}

/** What an Overview card, or a part of the line under the Overview's title, is given. */
export interface UiCardProps {
  /** The registered projects that have the module, in the registry's order; with a project picked, that one alone. */
  projects: UiProject[]
  /**
   * The shell's line under one account's row, for a card that lists a coding agent's accounts:
   * where the account works, on the person's devices. Absent where the page has nothing to add.
   */
  accountWhere?: (account: UiAccount) => ReactNode
}

/** The Context as a pane sees it: the files the next run is pointed at. */
export interface UiContext {
  /** The Context's files, as repo-relative paths. */
  files: ReadonlySet<string>
  /** Add the path to the Context, or take it out when it is in. */
  toggle(path: string): void
}

/** What a pane beside the chat is given: the project on screen, the run selected in it, the Context. */
export interface UiPaneProps {
  projectId: string
  /** The run whose page this is; absent on the project's own page. */
  agentId?: string
  /** How many events the run's feed has shown: it grows each time the agent does something. Absent on the project's own page. */
  activity?: number
  /** On a pane that lists what a run changed (`changes`): the changed file a click in the chat asked to see; no path for all of them. `at` tells one ask from the next. */
  reveal?: { path?: string; at: number }
  /** On a pane that shows a run's files (`files`): the file a click in the chat asked to see, by its path as the agent named it. `at` tells one ask from the next. */
  show?: { path: string; at: number }
  context: UiContext
}

/** What a part of a run's page is given: the run, and whether its agent is working. */
export interface UiRunProps {
  projectId: string
  agentId: string
  /** The run's agent is still working: a run that ended, or stopped on a question, is not. */
  working: boolean
}

/** What a part of the Permissions page is given. */
export interface UiPermissionsProps {
  /** The shell's line under one account's row, for a part that lists a coding agent's accounts: where the account works, on the person's devices. */
  accountWhere?: (account: UiAccount) => ReactNode
}

/** What a Settings entry is given: the projects whose settings it shows and saves. */
export interface UiSettingsProps {
  /** The projects the entry is for: the one picked in Settings, or every project that has the module with "All projects"; none for a module of the computer's. */
  projects: UiProject[]
  /** A page inside the entry to open, by what the entry knows it as. */
  item?: string
}

/** What the usage bar's line is given: the bar it is drawn on, for the projects that have the module. */
export interface UiUsageLineProps {
  projects: UiProject[]
  /**
   * The week's usage bar, as the shell draws it, with the line at `offset` (percentage points
   * from the quota boundary, negative before it) and its handle calling `onChangeOffset` as it
   * is dragged: the view draws it, with what it reads and saves of the line.
   */
  Bar: ComponentType<{ offset?: number; onChangeOffset?: (points: number) => void }>
}

/**
 * The view places, by name: what an entry says of itself there (`entry`), and what its
 * component is given (`props`).
 */
export interface ViewPlaces {
  /** A page, with its row in the sidebar: `/<id>`, and `/<project>/<id>` with a project picked. */
  'app.page': {
    entry: {
      /** The page's address word: a lowercase letter, then lowercase letters and digits, never `overview` or `settings`. */
      id: string
      /** The sidebar row's label. */
      label: string
      /** The sidebar row's icon; a generic one when absent. */
      icon?: UiIcon
      /**
       * What the paths into a project's files whose first segment is this page's are called, as
       * other pages that show such a path ask (a queue entry naming `tickets/2026-01-01_x.md`):
       * the ones it can name, by path.
       */
      names?(host: UiHost, projectId: string, paths: string[]): Promise<Record<string, UiFileName>>
    }
    props: UiPageProps
  }
  /** Drawn over every page, for as long as the dashboard is open: a module of the computer's, such as another computer asking to connect. */
  'app.overlay': { entry: { id: string }; props: Record<string, never> }
  /** An Overview card. */
  'overview.card': {
    entry: {
      /** Which card this is, for the shell's key and its error line; never shown as a title. */
      id: string
      /** Its name where the person arranges the Overview's cards. */
      label: string
      /** How wide it stands until the person picks: half the Overview when unsaid. */
      width?: UiCardWidth
      /** The narrowest it fits: a third of the Overview when unsaid. */
      minWidth?: UiCardWidth
      /** Its place among every module's cards, lower first; 50 when unsaid, ties by package name. */
      order?: number
      /**
       * It is the card of what needs the person: the first steps a new install still has to take
       * stand right under it, wherever the layout puts it, and no card after it is drawn until
       * what waits on the person was first read. The first module's card that says so.
       */
      needsYou?: true
    }
    props: UiCardProps
  }
  /** A few words in the line under the Overview's title. */
  'overview.line': { entry: { id: string; label: string; order?: number }; props: UiCardProps }
  /** A pane beside the chat, on every project's page and every run's page: an icon in the page's top bar opens it. */
  'chat.pane': {
    entry: {
      /** Which pane this is among the module's own, for its key and for remembering that it is open. */
      id: string
      /** Its name: on its card, and what its icon is called. */
      label: string
      icon: UiIcon
      /** It lists what a run changed: the chat's row of a changed file opens it, handing it the file as `reveal`. */
      changes?: true
      /** It shows a run's files: a file named in the chat opens it, handing it the file as `show`. */
      files?: true
      /** It shows a run's live screen: the chat's row of a live screen opens it. */
      screen?: true
    }
    props: UiPaneProps
  }
  /** A few words in the bar above a run's message box, until the run has ended and its branch was read. */
  'chat.summary': { entry: { id: string }; props: UiRunProps }
  /** An entry in Settings: the module's own settings. */
  'settings.section': {
    entry: {
      /** Which entry this is: the shell's key, and its name in the address (`?settings=<id>`). */
      id: string
      title: string
      icon: UiIcon
      /**
       * Its place among the entries of its group, lower first; 50 when unsaid, ties by package name.
       * Among the person's and this computer's, the dashboard's own stand at 20 to 80.
       */
      order?: number
      /** The entry only shows what is (skills' list of a project's own skills): with every project picked, no line says which projects a change is saved to. */
      readOnly?: true
    }
    props: UiSettingsProps
  }
  /** A part of the Permissions page, which lists every account OpenAgent's work goes as: the accounts the module adds, and what they reach. */
  'permissions.section': {
    entry: {
      /** Which part this is among the module's own, for the shell's key. */
      id: string
      /** Its name, in the line a part that failed says. */
      label: string
      /** Its place among every module's parts, lower first; 50 when unsaid, ties by package name. */
      order?: number
    }
    props: UiPermissionsProps
  }
  /** The line on the usage bar where the module's unattended work stops; the first module's that has one. */
  'usage.line': { entry: { id: string }; props: UiUsageLineProps }
}

export type ViewPlace = keyof ViewPlaces

/** A component at a place. */
export type UiView = { [P in ViewPlace]: { place: P; View: ComponentType<ViewPlaces[P]['props']> } & ViewPlaces[P]['entry'] }[ViewPlace]

/** A link a page shows: the name of some work and where it points. */
export interface UiLink {
  /** The link's text: the name of the work. */
  text: string
  /** Where it points: a path in the project's repository (`tickets/2026-01-01_x.md`) or an absolute URL; absent for text that points nowhere. */
  href?: string
  /** How urgent the page says the work is, 0 (only if capacity) to 10 (critical); absent when it does not say. */
  priority?: number
}

/** What an action did: done, or stopped, with the reason. */
export type UiActionResult = { ok: true } | { ok: false; error: string }

/** The action places, by name: what an action there is done on. */
export interface ActionPlaces {
  /** Beside a link a page shows, of a project that has the module: the queue's "Add to queue". */
  'link.menu': { projectId: string; links: UiLink[] }
}

export type ActionPlace = keyof ActionPlaces

/** Something to do at a place. */
export type UiAction = {
  [P in ActionPlace]: {
    place: P
    /** Which action this is among the module's own. */
    id: string
    /** Its label, a short verb phrase: "Add to queue". */
    label: string
    /** What it says while it runs: "Adding…". The label with a spinner otherwise. */
    busyLabel?: string
    /** What it says once done: "Queued". The label with a check mark otherwise. */
    doneLabel?: string
    icon?: UiIcon
    /** Do it, through the module's own commands; a batch stops at its first failure and says why. */
    run(host: UiHost, on: ActionPlaces[P]): Promise<UiActionResult>
    /** What of the place it is done on already: an action whose targets all are rests on its done label. */
    done?(host: UiHost, on: Omit<ActionPlaces[P], 'links'>): Promise<(link: UiLink) => boolean>
  }
}[ActionPlace]

/** The option places, by name: what an option there is. */
export interface OptionPlaces {
  /** The Auto menu's levels: how far a run takes its work, each with the sentence its pick adds to the prompt. */
  'composer.auto': { label: string; sentence: string }
  /** The project picker's entries beside the registered projects, such as the repos an account can reach. */
  'composer.where': { label: string; description?: string }
}

export type OptionPlace = keyof OptionPlaces

/** Something to pick in a shared menu. */
export type UiOption = { [P in OptionPlace]: { place: P; id: string; order?: number } & OptionPlaces[P] }[OptionPlace]

/** A question as its card asks it: what it asks, its options, and the id its answer names it by. */
export interface UiQuestion {
  id: string
  title: string
  options: readonly { id: string; label: string; detail?: string; default?: boolean }[]
  /** The option picked as the card opens, for a question with one pick. */
  recommended?: string
  /** Any number of options may be picked, those `default` checked as it opens. */
  multi?: boolean
}

/** What a question's card is given: the question, the run that asks it, and how the chat it is in takes the answer. */
export interface UiQuestionProps {
  /** The project the run is in: where the card's answer is called. */
  projectId: string
  agentId: string
  question: UiQuestion
  /** The one question the keys answer: the number keys pick, ⌘ or Ctrl + Enter submits. */
  active?: boolean
  /** The question the page opened on: its pick takes the focus as it shows, where the screen is no phone's. */
  focused?: boolean
  /** Told what the answer said to the agent, so the chat can show it at once. */
  onSaid?: ((text: string) => void) | undefined
  /** Given the focus once the answer is taken, when it was in the card and the screen is no phone's: the message box. */
  focusNext?: (() => void) | undefined
  /**
   * Where the pick goes instead of the module's own answer: the picked option, or the checked
   * ones. With it the card offers the options alone: a session elsewhere takes no words of the
   * person's, nor a skip.
   */
  send?: ((pick: string | string[]) => Promise<unknown>) | undefined
}

/** The kinds of content drawn from props of their own rather than from a text, by kind: what each one's `Render` is given. */
export interface RenderKinds {
  /** A question a run stopped on, asked in the chat under what the agent said. */
  question: UiQuestionProps
}

export type RenderKind = keyof RenderKinds

/** The kinds {@link RenderKinds} names: a fenced block of one of these languages is code, and none of them. */
export const RENDER_KINDS: readonly RenderKind[] = ['question']

/** How a text of a kind looks: `markdown`, or a fenced block of one language (`mermaid`), its content the block's. */
export interface UiTextRender {
  kind: string
  /**
   * Its look; none for content the module shows elsewhere: the chat leaves a block of it out of a
   * message whose question it asks, the card under the message asking it (ask's question block),
   * and draws it as written anywhere else, so a block nothing came of is seen as it is.
   */
  Render?: ComponentType<{ content: string }>
}

/** How a kind of content looks: markdown, a mermaid block, a tool call, a question, a screen. */
export type UiRender = { [K in RenderKind]: { kind: K; Render: ComponentType<RenderKinds[K]> } }[RenderKind] | UiTextRender

/** The hooks a module's UI part fills, by name. */
export interface UiHooks {
  'ui.view'?: readonly UiView[]
  'ui.action'?: readonly UiAction[]
  'ui.option'?: readonly UiOption[]
  'ui.render'?: readonly UiRender[]
}

/** A command that starts by itself in a project, as the module that schedules it says. */
export interface UiScheduledCommand {
  /** The command as a person types it, without its slash: `work-queue`. */
  command: string
  /** Whether it starts by itself on this computer right now. */
  on: boolean
  /** One line on it: when it starts next while it is on, or why it does not start though its switch is on. */
  note?: string
}

/** A module's UI part: what its package's `./dashboard` entry default-exports. */
export interface UiModuleDefinition {
  /** Its name, as its Node part's (`tickets`). */
  name: string
  hooks: UiHooks
  /**
   * What starts by itself, for the other modules' pages: which commands, and whether each is on;
   * the first module's that says. Until the settings catalog holds the scheduler's switches, which
   * the queue reads there (#2394).
   */
  schedule?: {
    /** The module's own page where a person switches a command on, by its id. */
    page: string
    /** One project's commands that can start by themselves. Rejects when they cannot be read. */
    read(host: UiHost, project: UiProject): Promise<UiScheduledCommand[]>
  }
}

/** Type a module's UI part: `export default defineUiModule({ ... })`. */
export function defineUiModule(definition: UiModuleDefinition): UiModuleDefinition {
  return definition
}
