import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import type { RunOptions } from '@openagt/hooks'
import type { ProjectSummary } from '../../src/index.js'
import { onStartCheck } from '../rpc/projects.js'
import { usePreferences, updatePreferences } from '../lib/preferences.js'
import { hostTarget, useRunHosts, useSelectedHost } from '../lib/run-hosts.js'
import type { StartPicks } from '../lib/started-from.js'
import { startPicks, useStartAgent } from '../lib/use-start-agent.js'
import { useProjectLauncher } from '../lib/use-project-launcher.js'
import { useLoaded } from '../lib/use-async.js'

import { promptWithContext } from '../lib/use-context-set.js'
import { keepDraft, keepDraftImages, stashPendingDraft } from '../lib/draft-handoff.js'
import { AutoMenu, autoCovers, autoPickIn, autoSaid, useAutoLevels } from './AutoMenu.js'
import { Composer, type ComposerHandle } from './Composer.js'
import { Dots } from './ToolCalls.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { shortcut } from '../lib/shortcut.js'
import { useIsMobile } from '../lib/use-mobile.js'
import { InlineMarkdown } from './Markdown.js'
import { cn } from '../lib/utils.js'
import { useAttention } from '../lib/use-attention.js'
import { SetupItemsLine } from './Attention.js'

/** The note while the start is asked for: what the chat's first line says next. */
const STARTING = 'Starting session'
/** How long a start is asked for before the note says so: a refusal in less is not preceded by a flash of it. */
const STARTING_SAID_AFTER_MS = 300


// Start a run in the selected project (#405): a free-text box, where `/` lists the project's
// commands, and Start (posted over `sendStart`), which the daemon hands to the computer's run host
// (#2394). The editor + control row are the shared Composer (#721); this form owns the submit.
// What would stop the run (a coding agent not installed or logged out) is said before the Start,
// from the check of the host the run goes to: this computer's, or the one picked in "Run on". The
// line a press fixes is said with its press inside: logging the agent in here. All of it is said
// above the box, over the page, where the Start's own line is: the box does not move when it
// comes or goes.
// The Context picker (#439/#314) gives the run files to look at: the picked files ride the prompt as
// one `Context:` line at its end. The repos a session works with are a module's control after it
// (`composer.control` at `context`), which writes them to the run's options.
// The row above the box says where the Start goes: the "Run on" pick, which the Composer draws
// first, then the modules' controls there (`composer.control` at `start`: the project, the projects
// module's picker, and the branch the agent starts from).
// Under the box, first, the gear: the session's setup in one menu (SessionSetup.tsx), then the
// Context picker and the modules' controls there; the model menu is at the right. The gear's hover says its picks, so nothing is hidden.
// Its last line, set apart, "When it finishes": what the agent does by itself then (the Auto level).
// In it, how far the run takes its work: Off, then the levels the modules offer (`composer.auto`),
// then Open PR and Merge on green where the project has a git host.
// The level goes with the Start; Off sends none. Until the person
// picks, the button shows the pick the daemon will start the run at: Commit, which pushes
// nothing. Saved, so the pick holds for every next run.
// The gear's first lines are the modules' (`composer.control` at `setup`): what they pick goes with
// the Start in its run options.
// With no project (`SESSIONS_ID`), the run starts in a folder of its own on this computer: the row
// says "No project", and nothing about a repository is offered, no branch. It has no file Context:
// it has no files of a project's to point at.
export function StartAgentForm({
  projectId,
  projectName,
  onAgentStarted,
  files,
  context,
  addContext,
  removeContext,
  toggleContext,
  onPickProject,
  onOverview = false,
}: {
  projectId: string
  /** The box is the Overview's: as wide as the page's cards, whose edges it stands on, where the launcher's is a session's message box's. */
  onOverview?: boolean
  /** Another project, or no project, was picked for the session: the launcher opens its "New agent session" page, the Overview shows that project's. */
  onPickProject: (projectId: string) => void
  /** The project's name, for the row above the box; absent until the projects are read. */
  projectName?: string | null | undefined
  /** `runsOn` names the host a run on one beside this computer goes to, for the "runs on <host>" marker. */
  onAgentStarted?: ((intent: string, agentId: string, runsOn?: string, picks?: StartPicks) => void) | undefined
  /** The project's files for the `#` picker (#504), owned by the shell. */
  files: string[]
  /** The Context set, shared with the Files pane's tree (#492), owned by the shell. */
  context: Set<string>
  /** Add a path to the Context (from an `@`/`#` mention). */
  addContext: (path: string) => void
  /** Drop a path from the Context when its `@`/`#` chip leaves the editor (#948). */
  removeContext: (path: string) => void
  /** Toggle a path in the Context (a project's checkbox, a file's cross). */
  toggleContext: (path: string) => void
}) {
  const [note, setNote] = useState<string | null>(null)
  const [startingSaid, setStartingSaid] = useState(false)
  useEffect(() => {
    setStartingSaid(false)
    if (note !== STARTING) return
    const timer = setTimeout(() => setStartingSaid(true), STARTING_SAID_AFTER_MS)
    return () => clearTimeout(timer)
  }, [note])
  const { busy, error, reset, start } = useStartAgent()
  const composerRef = useRef<ComposerHandle>(null)
  const phone = useIsMobile()
  // A refused start gives the prompt the focus once the box is on again, however Start was pressed:
  // the prompt is fixed and sent again from the keyboard.
  const [refused, setRefused] = useState(false)
  useEffect(() => {
    if (!refused || busy) return
    setRefused(false)
    composerRef.current?.focus()
  }, [refused, busy])
  const preferences = usePreferences()
  const launcher = useProjectLauncher(projectId)
  const noProject = projectId === SESSIONS_ID
  // What the modules' controls picked for the next run alone (`composer.control`), until it starts or another project is picked.
  const [options, setOptions] = useState<RunOptions>({})
  useEffect(() => setOptions({}), [projectId])
  // What the box holds, so another project picked takes the prompt along to its page.
  const typed = useRef('')
  const pickProject = (id: string) => {
    if (id === projectId) return
    if (typed.current.trim()) stashPendingDraft(typed.current)
    onPickProject(id)
  }

  // A host the project's modules bring, picked in "Run on" (a CI runner): the start names
  // it by its id, and the daemon starts the run there.
  const host = hostTarget(useRunHosts(noProject ? null : projectId), useSelectedHost())
  // What would stop a run these picks start on this computer, as the modules say it (`app.attention`):
  // said above the box, each with its fix. A host beside this computer says what stops a run there itself, in its check.
  const attention = useAttention(projectId, host ? undefined : options)
  // A project with no remote can publish nothing: its picks stop at the commit.
  const remote = launcher?.remote ?? true
  // The project as a place is given it, once the launcher is read: whether it has a remote is what a
  // module tells its levels by. With no project the level is for the session's copies of repos,
  // whatever host each is on: every level is offered.
  const autoProject = !noProject && launcher ? { id: projectId, name: projectName ?? projectId, ...(remote ? { remote: launcher.address ?? 'origin' } : {}) } : undefined
  const levels = useAutoLevels(projectId, autoProject)
  const publishPick = autoPickIn(preferences.publish, levels)

  // Asked again at each change of the picks, and once what the modules said would stop the run is
  // fixed: the host's own check says what is still in the way.
  const runItems = (attention ?? []).filter(item => item.scope === 'run').length
  const readiness = useLoaded(() => (host ? onStartCheck(projectId, options, host.id) : onStartCheck(projectId, options)), null, [projectId, JSON.stringify(options), runItems, host?.id])
  // What the gear's hover says of its own line with the menu shut; the modules' lines say theirs.
  const setupSaid = autoSaid(publishPick, levels)

  const submit = async (text: string, { images }: { images: string[] }) => {
    setNote(STARTING)
    const { publish: _publish, ...unpublished } = startPicks(preferences)
    const withImages = images.length > 0 ? { images } : {}
    const result = await start(projectId, promptWithContext(text, noProject ? [] : [...context]), {
      ...withImages,
      ...(Object.keys(options).length > 0 ? { options } : {}),
      // A project's Start carries the saved pick alone, and the daemon holds it to what the project is offered; with no
      // project the pick in force goes, for the repos it has.
      ...(noProject ? { ...unpublished, publish: publishPick } : startPicks(preferences)),
      ...(host ? { host: host.id } : {}),
    })
    setNote(null)
    if (result) {
      // Show the run in the Runs rail immediately (#405): its tool writes the run's card a beat
      // later, so seed an optimistic row with the typed prompt until the real one takes over.
      // A run on a host carries the host's label, so the view can mark where it executes.
      // What this page says goes with it, for the run's page until the run's record says it.
      // The box keeps the words until the move has taken its picture of them; its draft goes with the page.
      void carryBox(() => {
        keepDraft(`launcher:${projectId}`, '')
        keepDraftImages(`launcher:${projectId}`, [])
        onAgentStarted?.(text, result.agentId, host?.label, {
          ...(Object.keys(options).length > 0 ? { options } : {}),
          publish: publishPick,
          ...withImages,
        }) // select the run we just started (#761)
      }).finally(() => composerRef.current?.clear())
      setOptions({})
    } else setRefused(true)
  }

  const loaded = (label: string, replaced: boolean) => {
    reset()
    setNote(replaced ? `${label} loaded over your draft — undo (${shortcut('Z')}) brings the draft back` : `${label} loaded — review or edit, then Start`)
  }

  return (
    // The width and the padding of an agent's message box (`AgentComposer.tsx`): the box is in the
    // same place on both pages. On the Overview it is the page's column, as its cards are.
    <form onSubmit={e => e.preventDefault()} className={cn('@container w-full', !onOverview && 'mx-auto max-w-3xl px-4 pt-2 pb-4')}>
      <Composer
        // A box of its own per project, so the prompt carried over from the picker lands in it (below).
        key={projectId}
        ref={composerRef}
        draftKey={`launcher:${projectId}`}
        // The page is the prompt, so typing goes there at once; not on a phone, where the keyboard would rise over the page.
        autoFocus={!phone}
        files={files}
        addContext={addContext}
        removeContext={removeContext}
        controlBox={{ in: 'launcher', projectId, options, onChange: setOptions, busy, pickProject: id => pickProject(id ?? SESSIONS_ID) }}
        // The gear's lines (his order), after the modules': set apart, what becomes of the work.
        setup={{
          said: setupSaid,
          lines: (
            <>
              <AutoMenu publish={publishPick} levels={levels} onPublish={pick => updatePreferences({ publish: pick })} covers={autoCovers(noProject)} />
            </>
          ),
        }}
        // The files picked for the message (a `#`, the Files pane), as chips in the box.
        {...(noProject ? {} : { attached: [...context], onDetach: toggleContext })}
        onSubmit={submit}
        onPromptChange={value => {
          typed.current = value
          if (!value.trim() && note) setNote(null)
          // Editing after a failed start: the red error described the old attempt, drop it (#948).
          if (error) reset()
        }}
        onLoaded={loaded}
        busy={busy}
        submitLabel="Start agent"
        submitBusyLabel="Starting…"
        // Feedback right where the action is (#948): above the box, over the page, so the box never moves.
        // On the Overview under the box's row: the page's own line is right above the box.
        notesUnder={onOverview}
        notes={
          <>
            {/* A start that hit what the check says says nothing the boxes below do not. */}
            {error && !readiness?.problems.length && <Refusal {...said(error)} />}
            {/* What the host's check says its agent's own fix is for, a module's item about the run says, with its press. */}
            {readiness?.problems
              .filter(problem => !(problem === readiness.fix?.problem && runItems > 0))
              .map(problem => (
                <Refusal key={problem} {...said(problem)} />
              ))}
            <SetupItemsLine items={attention ?? []} projectId={projectId} />
            {readiness?.warnings.map(warning => (
              <p key={warning} role="alert" className="flex items-start gap-2 rounded-lg bg-[color-mix(in_oklab,var(--color-warning)_8%,var(--color-background))] px-3 py-2 text-sm text-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {/* One flex item: the sentence's code marks flow in it as words do. */}
                <span className="min-w-0">
                  <InlineMarkdown text={warning} />
                </span>
              </p>
            ))}
            {note === STARTING && startingSaid && !error && (
              // The chat's own first line (`SessionLine.tsx`), in its words and its look: the page that
              // opens a moment later goes on saying it.
              <p role="status" className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
                <Dots />
                <span className="text-shimmer">{note}</span>
              </p>
            )}
            {note !== STARTING && note && !error && <p role="status" className="px-2 text-xs text-muted-foreground">{note}</p>}
          </>
        }
      />
    </form>
  )
}

/**
 * Starting a run carries the box from this page to its place on the run's page in one movement: the
 * browser's own view transition, the box named the same on both (`composer`, Composer and
 * tailwind.css), and the words in it the same as the run's first message (`words`). Under reduced
 * motion, or where the browser has none, the page just changes. Settles once the move is over.
 */
function carryBox(update: () => void): Promise<void> {
  if (typeof document.startViewTransition !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update()
    return Promise.resolve()
  }
  const root = document.documentElement
  root.classList.add('carrying-box')
  return document.startViewTransition(() => flushSync(update)).finished.finally(() => root.classList.remove('carrying-box'))
}

/**
 * Why no run starts, or would not, above the message box: what is wrong in one line, then smaller
 * what to do about it, and the press that does it. The tint and the mark say it is wrong; the words are the
 * text's own colour, which reads on the tint. Opaque, since it lies over the page.
 */
function Refusal({ title, detail, actions }: { title: ReactNode; detail?: ReactNode | undefined; actions?: ReactNode | undefined }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-[color-mix(in_oklab,var(--color-danger)_8%,var(--color-background))] px-3 py-2 text-foreground">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="text-sm font-medium">{title}</p>
        {detail !== undefined && (
          <>
            {' '}
            <p className="mt-0.5 text-xs">{detail}</p>
          </>
        )}
        {/* Its presses are a finger's 44 on a phone, as every press there is. */}
        {actions !== undefined && <div className="mt-2 flex flex-wrap items-center gap-2 text-foreground max-md:[&_button]:h-11">{actions}</div>}
      </div>
    </div>
  )
}

/**
 * A line said whole, as a title and what follows it: split after its first sentence, when that
 * sentence is short enough to read as one. A daemon's words come as one line, with
 * the names and commands in it in backticks: drawn as code, as the chat draws them.
 */
function said(line: string): { title: ReactNode; detail?: ReactNode } {
  const end = line.search(/\.\s+(?=[A-Z`@])/)
  if (end <= 0 || end > 140) return { title: <InlineMarkdown text={line} /> }
  return { title: <InlineMarkdown text={line.slice(0, end + 1)} />, detail: <InlineMarkdown text={line.slice(end + 1).trim()} /> }
}
