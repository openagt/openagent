// The UI hooks (#2394): what a module's UI part fills, each at one of the shell's places. A
// module's UI part is an entry of its package of its own (`./dashboard`), which the shell loads
// in the browser; its Node part's hooks are `./module`'s, so a run's process never loads React.
// Four hooks, each taking a place: a component at a place (`ui.view`), something to do at one
// (`ui.action`), something to pick in a shared menu (`ui.option`), and how a kind of content looks
// (`ui.render`). Each place's props are typed here, so a new place needs no new hook.
import type { ComponentType } from 'react'
import type { PullRequest, PullRequestState, RunOptions } from './run.js'

/** An icon, drawn at the size its `className` gives. */
export type UiIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

/** A registered project that has the module, as a place is given it. */
export interface UiProject {
  id: string
  name: string
  /**
   * Its repository's address, origin's, as `ProjectRef.remote` names it (`github.com/me/shop`):
   * where a module tells whether the project is on its git host. None for a project with no
   * remote, whose work stays on this computer.
   */
  remote?: string
}

/** What the shell does for an entry's functions, as a view gets it from the shell's `useModuleHost`: the module's own package's commands, run in a project, and what an action opens or starts. */
export interface UiHost {
  /** The module's package. */
  readonly package: string
  /** Run one of the package's commands in the project, its answer read as JSON; `command` names which, when the package has several. */
  runCommand(projectId: string, args: string[], command?: string): Promise<UiCommandResult>
  /** Run one of the package's commands in the project to change something, its answer read as JSON; what was read of the package's data is read again after it. */
  act(projectId: string, args: string[], command?: string): Promise<UiCommandResult>
  /** Call one function of the package's server part in the project (`@openagt/hooks/rpc`), its answer read as JSON. */
  call(projectId: string, name: string, input: object): Promise<UiCommandResult>
  /** Open an entry of Settings over the page, by its id; with `item`, at that page inside it (a project's entry: the project's id). */
  openSettings(entry: string, item?: string): void
  /** Start a run in the project with this prompt, with the person's own picks, and land on it: the run's id, or in words why there is none. */
  startRun(projectId: string, prompt: string): Promise<{ ok: true; agentId: string } | { ok: false; error: string }>
  /** Call one function of the package's server part in no project, for a package of the computer's (`for: 'computer'`), its answer read as JSON. */
  callComputer(name: string, input: object): Promise<UiCommandResult>
}

/** What a command or a call answered: its output read as JSON, or in words why there is none. */
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

/** What an Overview card, or a part of the line under the Overview's title, is given. */
export interface UiCardProps {
  /** The registered projects that have the module, in the registry's order; with a project picked, that one alone. */
  projects: UiProject[]
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
  /** The run's copied repo the pane is opened on, in a tab of its own: its name in the session's folder. Absent: the project. */
  repo?: string
  /** The session has no project: only its copies of repositories have files and changes. */
  copiesOnly?: true
  context: UiContext
}

/** What a part of a run's page is given: the run, and whether its agent is working. */
export interface UiRunProps {
  projectId: string
  agentId: string
  /** The run's agent is still working: a run that ended, or stopped on a question, is not. */
  working: boolean
}

/**
 * What a row of the panel of a session's work above its message box is given: the run, where it
 * stands as its page knows it, and what the shell knows of it beside its work.
 */
export interface UiWorkProps extends UiRunProps {
  /**
   * The run works, or is about to (a message was just sent to it): what its work holds is still
   * being written. Neither this nor {@link ended}: not known yet.
   */
  working: boolean
  /** The run has ended: what its work holds is read, and its next steps are offered (`chat.handoff`). */
  ended: boolean
  /** It ended, and its clean-up is still going: its record being saved, its checkout cleaned up. */
  saving: boolean
  /** The session's project, by its name: the project's row is named by it. */
  projectName?: string
  /** The pull request the run's record names, and how it stands as its git host module last read it. */
  pr?: PullRequest & { state?: PullRequestState; title?: string }
}

/** What a strip above a run's chat is given: the run, and the host it runs on. */
export interface UiRunNoticeProps extends UiRunProps {
  /** The host the run runs on, by its id (`RunHost.id`): this computer's when absent. */
  host?: string
}

/** A prompt a person saved, as the message box offers it: its menus list it, and a pick loads its text into the box. */
export interface UiPrompt {
  /** Which prompt this is among the module's own: what deleting it names. */
  id: string
  /** Its name, as the menus list it. */
  label: string
  /** What it loads into the box, word for word. */
  text: string
  /** Whose it is, as the menus group it: "Your saved prompts". */
  group: string
}

/** What the panel that saves a prompt is given: the box's project, what the box holds, and how it says it is done. */
export interface UiPromptSaveProps {
  /** The project the box is in: where a prompt saved as the project's is kept. */
  projectId: string
  /** What the box holds as the panel opens: what is saved, unless the person changes it. */
  text: string
  /** The panel is done, `saved` when it saved a prompt: the box reads its prompts again. */
  onDone(saved: boolean): void
}

/** What a Settings entry is given: the projects whose settings it shows and saves. */
export interface UiSettingsProps {
  /** The projects the entry is for: the one picked in Settings, or every project that has the module with "All projects"; none for a module of the computer's. */
  projects: UiProject[]
  /** A page inside the entry to open, by what the entry knows it as. */
  item?: string
}

/**
 * How far either side of the quota boundary the usage bar's handle reaches, in percentage points
 * (#960): the bound of the line a module puts on the bar, which the bar holds a drag to.
 */
export const MAX_SPEND_OFFSET = 50

/** What the usage bar's line is given: the bar it is drawn on, for the projects that have the module. */
export interface UiUsageLineProps {
  projects: UiProject[]
  /**
   * The week's usage bar, with the line at `offset` (percentage points from the quota boundary,
   * negative before it, within {@link MAX_SPEND_OFFSET}). Its handle moves the line as it is
   * dragged, and saves where it rests through `onChangeOffset`, saying under the bar why a save
   * failed: the view draws it, with what it reads of the line.
   */
  Bar: ComponentType<{ offset?: number; onChangeOffset?: (points: number) => Promise<UiActionResult> }>
}

/** Which box a control under the message box is drawn in. */
export type UiComposerIn =
  /** The launcher's: the picks of the next run, which go with its Start. */
  | 'launcher'
  /** A session's: the picks it started with, as its record keeps them; said, and not offered, unless the control can change them for its next message. */
  | 'session'
  /** A profile's editor: the profile's options, which a run on it gets where it picks none. */
  | 'profile'

/** What a control says of its pick with the gear's menu shut, in its hover; and whether a run needs a press of it first. */
export interface UiControlSaid {
  /** A few words: "3 skills", "@octocat". */
  words: string
  /** It needs a press before a run can do its work (no account to push as): the gear is in the warning's colour. */
  warn?: boolean
}

/** What a control under the message box is given: the box it is in, the run options picked there, and how it changes them. */
export interface UiComposerControlProps {
  in: UiComposerIn
  /** The project the box is in; none for a session with no project, and in a profile's editor, which is for any project. */
  projectId?: string
  /** The session whose box it is, in a session's box. */
  agentId?: string
  /**
   * The options picked: the next run's in the launcher (the ones picked for that run alone: a pick
   * made for every run is its module's setting, which its step reads where the run's options say
   * nothing), the session's as its next message goes with them, the profile's in its editor.
   */
  options: RunOptions
  /** In a session's box: its options as its record keeps them, which its next message can add to and not take back. */
  recorded?: RunOptions
  /** Change the options picked, whole: the next run's, the next message's in a session's box, the profile's in its editor. */
  onChange(options: RunOptions): void
  /** A start or a send is under way: the control takes no pick. */
  busy: boolean
  /** In the launcher: move it to another project, or to no project (`undefined`), what is typed in the box taken along. */
  pickProject?(projectId: string | undefined): void
  /** Say what the control picks, for the gear's hover with its menu shut; nothing to say when it is not drawn. A control in the gear's menu stays mounted while the menu is shut. */
  say(said: UiControlSaid | undefined): void
}

/** What the labels at the end of the row above a session's message box are given: the run, and whether its agent is working. */
export type UiChatLabelsProps = UiRunProps

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
      /** Its row's place among the modules' pages, lower first; 50 when unsaid, ties in the order the modules are loaded. */
      order?: number
    }
    props: UiPageProps
  }
  /** Drawn over every page, for as long as the dashboard is open: a module of the computer's, such as the browser's notifier. */
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
       * It is the card of what needs the person: the Overview's notices (`overview.notice`) stand
       * right under it, wherever the layout puts it, and no card after it is drawn until what
       * waits on the person was first read. The first module's card that says so.
       */
      needsYou?: true
    }
    props: UiCardProps
  }
  /** A few words in the line under the Overview's title. */
  'overview.line': { entry: { id: string; label: string; order?: number }; props: UiCardProps }
  /** A notice on the Overview, under the card of what needs the person: news of this computer, such as a coding agent's newer version. Nothing drawn when there is none. */
  'overview.notice': { entry: { id: string; order?: number }; props: UiCardProps }
  /** A pane beside the chat, on every project's page and every run's page: a tab of the side panel, which the panel's "+" and its list open. */
  'chat.pane': {
    entry: {
      /** Which pane this is among the module's own, for its key and for remembering that it is open. */
      id: string
      /** Its name: on its tab, and in the panel's "+" and list. */
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
  /**
   * A few words in the project's row of the panel above a run's message box, while the run works
   * and until what its work holds is read (ui-pane-changes': what the run has changed so far). The
   * module that draws the project's row (`chat.work`) draws them in it.
   */
  'chat.summary': { entry: { id: string }; props: UiRunProps }
  /**
   * The rows of the panel of a session's work above its message box, by `order`: the project's
   * (git-branches': its branch, what the branch holds, its pull request and its next steps), then
   * one per repo the session holds work in beside its project (git-branches' copies of repos), each
   * with its next steps (`chat.handoff`, with the repo for a copy). A row with nothing to say draws
   * nothing, and a panel with no row is not drawn.
   */
  'chat.work': { entry: { id: string; order?: number }; props: UiWorkProps }
  /**
   * Rows of the Environment of a session's Activity panel, after where it runs and its project, by
   * `order`: git-branches' copies of repos, each by the repository it is a copy of. Drawn with the
   * shell's `EnvironmentRow`.
   */
  'chat.environment': { entry: { id: string; order?: number }; props: UiRunProps }
  /** A strip above a run's chat, with a word on the run: a host's, on a run it runs, say where the run is and when its news comes. */
  'chat.notice': { entry: { id: string }; props: UiRunNoticeProps }
  /** Words at the end of the row above a session's message box: github's pull request labels. */
  'chat.labels': { entry: { id: string; order?: number }; props: UiChatLabelsProps }
  /**
   * A control of the message box, writing its module's run options: a line of the gear's menu
   * (`setup`), after the gear in the row under the box (`context`: where the run works and starts,
   * as Claude Code on the web has its environment, repos and branch there), or at the right of that
   * row (`row`: the model). Drawn in the launcher, in a session's box, and in a profile's editor.
   */
  'composer.control': { entry: { id: string; at: 'setup' | 'context' | 'row'; order?: number }; props: UiComposerControlProps }
  /**
   * Prompts a person saved, which the message box offers in its `/` menu and its Commands menu,
   * each loading its text into the box. The view is the panel that saves what the box holds as
   * one: the first module's, which the menus' "Save prompt…" opens.
   */
  'composer.prompts': {
    entry: {
      /** Which entry this is among the module's own, for the shell's key. */
      id: string
      /** The prompts the box offers in the project `projectId`, in the order the menus list them. */
      list(host: UiHost, projectId: string): Promise<UiPrompt[]>
      /** Delete one of them, by its id. */
      remove(host: UiHost, projectId: string, id: string): Promise<UiActionResult>
    }
    props: UiPromptSaveProps
  }
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
      /**
       * The entry is one project's at a time (where its data is kept): with every project picked, it
       * is drawn for none, and these words ask for one, with a press for each project that has it.
       */
      pickProject?: string
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
    props: Record<string, never>
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

/** What an action did: done, with what it did in a few words when the place says it ("Opened PR #12."), or stopped, with the reason. */
export type UiActionResult = { ok: true; said?: string } | { ok: false; error: string }

/** What is asked before an action runs. */
export interface UiConfirm {
  title: string
  description?: string
  /** The press that runs it: "Remove". */
  confirmLabel: string
  /** It loses something: the press is in the danger colour. */
  danger?: true
}

/**
 * What an action offers now, at a place whose actions come and go with what they act on (a
 * branch's next step, a project's menu): asked each time the place is drawn or what it is about
 * changes, and after any of its actions ran. None: it is not offered now.
 */
export interface UiOffer {
  /** Its label now, in place of the action's: "Update PR". */
  label?: string
  /** What its hover says. */
  title?: string
  /** A few words said beside it: in the bar under a run, "not in the PR yet"; at a menu item's right, "1.2 GB". */
  note?: string
  /** Only the note is said: there is nothing to press now ("Merged into main."). */
  noteOnly?: true
  /** It opens this address in a new tab, in place of running. */
  href?: string
  /** Asked before it runs. */
  confirm?: UiConfirm
  /** It loses something: drawn in the danger colour. */
  danger?: true
  /** Its place among the place's offers, lower first; the action's `order`, else 50, when unsaid. In the bar under a run the first is its press, the others are under its arrow. */
  rank?: number
}

/** The action places, by name: what an action there is done on. */
export interface ActionPlaces {
  /** Beside a link a page shows, of a project that has the module: the queue's "Add to queue". */
  'link.menu': { projectId: string; links: UiLink[] }
  /**
   * The bar above an ended run's message box: its work's next step (Commit, Open PR, Merge…),
   * for the run's own checkout, or for one of its copies of repos (`repo`, by its name).
   */
  'chat.handoff': { projectId: string; agentId: string; repo?: string }
  /** The menu of a session, under its name. */
  'chat.menu': { projectId: string; agentId: string }
  /** The menu of a project, on its pages' bars. */
  'project.menu': { projectId: string }
  /** The menu under the person's picture. */
  'person.menu': Record<string, never>
  /**
   * What fixes an item the module said needs the person (`AttentionFix.action` names the action by
   * its id), wherever the item is shown: the project it is about, and the item's id.
   */
  'attention.fix': { projectId?: string; item?: string }
}

export type ActionPlace = keyof ActionPlaces

/** Something to do at the place `P`. */
export interface UiActionAt<P extends ActionPlace> {
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
  /** Its place among the place's actions, lower first; 50 when unsaid, ties by package name. */
  order?: number
  /** Do it, through the module's own commands or server; a batch stops at its first failure and says why. None for one that only opens a link or a dialog. */
  run?(host: UiHost, on: ActionPlaces[P]): Promise<UiActionResult>
  /** What of the place it is done on already: an action whose targets all are rests on its done label. */
  done?(host: UiHost, on: Omit<ActionPlaces[P], 'links'>): Promise<(link: UiLink) => boolean>
  /** Whether it is offered now, and how: offered as it is declared when unsaid. */
  offer?(host: UiHost, on: ActionPlaces[P]): UiOffer | undefined | Promise<UiOffer | undefined>
  /** What it opens when pressed, in place of running: a dialog of the module's own, told when it is done. */
  Dialog?: ComponentType<{ on: ActionPlaces[P]; onDone(result?: UiActionResult): void }>
}

/** Something to do at a place. */
export type UiAction = { [P in ActionPlace]: UiActionAt<P> }[ActionPlace]

/** The option places, by name: what an option there is. */
export interface OptionPlaces {
  /**
   * The Auto menu's levels: how far a run takes its work, each with the sentence its pick adds to
   * the prompt. The option's id is the level it picks (`RunOptions.publish`); a project is offered
   * it where `offered` says so (a pull request where the project is on the module's git host), and a session with no project
   * (`project` none) where its copies of repos may be.
   */
  'composer.auto': {
    label: string
    /** What the menu says under the label: what the agent does when it finishes. */
    description?: string
    sentence: string
    offered?(project: UiProject | undefined): boolean
  }
  /**
   * The project picker's entries beside the registered projects: the repos on this computer that
   * are not projects yet, and the repos a module's accounts reach, which a pick adds as a project,
   * cloned as the account that reaches it (`account.access`). The picker leaves out a repo at an
   * address that is on this computer already.
   */
  'composer.where': {
    /** The heading the repos are listed under: "On GitHub". */
    label: string
    description?: string
    /** What the picker says while some of its repos are still being read: "Asking GitHub for repos…". */
    loadingWords?: string
    /** The repos it offers now; `loading` while some are still being read, `unreached` in words when an account could not be read. */
    repos(host: UiHost): Promise<{ repos: UiWhereRepo[]; loading?: boolean; unreached?: string }>
  }
  /**
   * Where the images a message goes with are kept: what the message box's attach button, a drop and
   * a paste take, the box's tiles and the chat's show, and a run is handed by the names they are kept
   * under (`RunInput.images`). The first module's; with none, a box takes no image.
   */
  'composer.images': {
    /** The kinds it keeps, by media type. A box draws an image past the bounds below smaller, as a PNG or else a JPEG: keep both. */
    types: readonly string[]
    /** Those kinds in words, for a file of another kind: "PNG, JPEG, GIF or WebP". */
    kinds: string
    /** The most bytes an image is kept at. */
    maxBytes: number
    /** The longest edge an image is kept at, in pixels. */
    maxEdge: number
    /** The most images one message goes with. */
    perMessage: number
    /** Keep an image of the media type `type`, its bytes in base64: the name a message names it by, or why it was not kept, in words. */
    keep(host: UiHost, image: { type: string; data: string }): Promise<{ ok: true; name: string } | { ok: false; error: string }>
    /** Where the page loads the image kept under `name`. */
    src(name: string): string
  }
  /**
   * The commands the message box offers in its `/` menu and its Commands menu: a module's, in the
   * project the box is in, none for a session with no project. A pick puts `/<name> ` in the box.
   */
  'composer.commands': {
    /** The commands it offers in the project `projectId` now, in the order the menus list them. */
    list(host: UiHost, projectId: string): Promise<UiCommand[]>
  }
  /**
   * Where a reference in a session's chat leads: `#12`, the issue or pull request of that number at
   * the project's git host, which the project's address says (`project.remote`). The first module's
   * that links it; with none, `#12` stays text.
   */
  'chat.references': {
    /** The page of issue or pull request `number` of `project`; none for a project the module does not answer for. */
    issue(project: UiProject, number: number): string | undefined
  }
}

/** A command the message box offers: typed after the slash, and what it asks the agent is the command's own. */
export interface UiCommand {
  /** What is typed after the slash. */
  name: string
  /** What it does, in a sentence: said beside its name. */
  description?: string
  /**
   * The branch it has yet to reach, by name, when a run started now would not have it: the `/`
   * menu leaves it out, and the Commands menu says it waits.
   */
  waiting?: string
}

/** A repository the project picker offers to add as a project: a folder on this computer, or an address it is cloned from. */
export interface UiWhereRepo {
  /** Its address, as `ProjectRef.remote` names a repository (`github.com/me/shop`): what a pick clones, with no `folder`. None for a folder whose repository has no remote. */
  address?: string
  /** Its folder on this computer, absolute: a pick adds it as it is, and nothing is cloned. */
  folder?: string
  /** Its name in the list: `me/shop`. */
  label: string
  /** Its description: what a search finds it by too. */
  detail?: string
  /** Only some can see it. */
  private?: true
  /** Why it is listed, said after its name: the account it is one of, or the owner the person named. */
  why?: string
  /** When it was last pushed to, ISO: the list shows the newest first. */
  pushedAt?: string
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

/**
 * How a text in markdown is set (an agent's reply, a ticket, a file read as a page), as the
 * dashboard asks for it wherever it shows one.
 */
export interface UiMarkdownProps {
  text: string
  /**
   * `chat`, the default: a reply in the chat, each line of it its own. `compact`: a notch smaller,
   * at the density of a log. `document`: a file read as a page. `page`: a document inside a
   * dashboard page (a ticket, its plan), in the page's own type. `inline`: one line's marks only
   * (code, links), for a sentence in a box of its own.
   */
  look?: 'chat' | 'compact' | 'document' | 'page' | 'inline'
  /** Each word comes in once, as the message is being written. */
  fade?: boolean
}

/** The kinds of content drawn from props of their own rather than from a text, by kind: what each one's `Render` is given. */
export interface RenderKinds {
  /** A question a run stopped on, asked in the chat under what the agent said. */
  question: UiQuestionProps
  /** A text in markdown, wherever the dashboard shows one: drawn as written where no module draws it. */
  markdown: UiMarkdownProps
}

export type RenderKind = keyof RenderKinds

/** The kinds {@link RenderKinds} names: a fenced block of one of these languages is code, and none of them. */
export const RENDER_KINDS: readonly RenderKind[] = ['question', 'markdown']

/** How a fenced block of one language looks (`mermaid`), its content the block's. */
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

/** A module's UI part: what its package's `./dashboard` entry default-exports. */
export interface UiModuleDefinition {
  /** Its name, as its Node part's (`tickets`). */
  name: string
  hooks: UiHooks
}

/** Type a module's UI part: `export default defineUiModule({ ... })`. */
export function defineUiModule(definition: UiModuleDefinition): UiModuleDefinition {
  return definition
}
