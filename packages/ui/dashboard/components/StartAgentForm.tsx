import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import type { ProjectSummary, StartFromPick } from '../../src/index.js'
import { onStartBranches, onStartCheck } from '../rpc/projects.js'
import { usePreferences, usePreferencesLoaded, updatePreferences } from '../lib/preferences.js'
import { DEFAULT_PROFILE, isDriverName, offeredPublishPicks, publishPickIn } from '../../src/client.js'
import { hostTarget, useRunHosts, useSelectedHost } from '../lib/run-hosts.js'
import type { StartPicks } from '../lib/started-from.js'
import { startPicks, useStartAgent } from '../lib/use-start-agent.js'
import { useProjectLauncher } from '../lib/use-project-launcher.js'
import { useLoaded } from '../lib/use-async.js'

import { promptWithContext } from '../lib/use-context-set.js'
import { keepDraft, keepDraftImages, stashPendingDraft } from '../lib/draft-handoff.js'
import { AutoMenu } from './AutoMenu.js'
import { ProjectContextMenu } from './ContextMenu.js'
import { Composer, type ComposerHandle } from './Composer.js'
import { StartFromMenu, prTargetBranch, startFromBase } from './StartFromMenu.js'
import { ProjectPicker } from './ProjectPicker.js'
import { SessionRepoPicks, type PickedRepo } from './SessionRepos.js'
import { Dots } from './ToolCalls.js'
import { AgentFix, agentWords, useAgentState } from './Logins.js'
import { profilePicks, SkillsMenu, type SkillPicks } from './SkillsMenu.js'
import { GitAccountMenu, useSessionAccount } from './GitHosts.js'
import { ProfileMenu } from './ProfileMenu.js'
import { useProfilesList } from './ProfilesPage.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { shortcut } from '../lib/shortcut.js'
import { useIsMobile } from '../lib/use-mobile.js'
import { InlineMarkdown } from './Markdown.js'

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
// The Context picker (#439/#314) narrows the run's focus to other projects and to files: the
// picked paths ride the prompt as one `Context:` line at its end.
// The row above the box says where the Start goes: the "Run on" pick, which the Composer draws
// first, then the project's name, then the branch the agent starts from.
// That branch is a menu: the project's main branch (origin's default branch, fetched fresh), "My
// local branch", the branch the project's folder is on, as committed on this machine, or another
// of origin's branches, fetched fresh. The pick is saved per project. It reaches the run as the
// branch its checkout is made from: the local branch's name, or origin's copy of the branch by its
// full name; the main branch names none. The pick is drawn only where it is obeyed: the daemon
// offers it only for a project with a remote whose folder is on a branch.
// The "Auto" menu, under the box at the left (the model menu is at the right): what the agent
// does by itself when it finishes. Its button reads the picks, so nothing is hidden.
// In it, how far the run takes its work: Off, Commit, Publish branch, Open PR, Merge on green.
// The level goes with the Start; Off sends none. Until the person
// picks, the button shows the pick the daemon will start the run at: Commit, which pushes
// nothing. Saved, so the pick holds for every next run. A project with no git host package
// is offered Off, Commit and Publish branch only, and one with no remote Off and Commit.
// At the right of that row, before the model: the git host account this session pushes as. A pick
// there is for this session alone: it goes with the Start, and the computer's own pick, the
// Permissions page's, stays. Not saved: the next session starts on the computer's again.
// First under the box, the "Profile" menu: which profile the session is on, its accounts and the
// project skills it gets (ProfileMenu.tsx); saved, like the model. Its GitHub account is what the
// account control shows until the person picks another for the session.
// With no project (`SESSIONS_ID`), the run starts in a folder of its own on this computer: the row
// says "No project", and nothing about a repository is offered, no branch, no account, no Auto
// level, no project Context or skills. Beside "No project", the repos the session has as context
// (SessionRepos.tsx): each is copied into the session's folder, and none is made a project.
export function StartAgentForm({
  projectId,
  projectName,
  onAgentStarted,
  files,
  context,
  addContext,
  removeContext,
  toggleContext,
  projects,
  onPickProject,
  onProjectAdded,
}: {
  projectId: string
  /** Every project, for the picker of where the session works (ProjectPicker). */
  projects: readonly ProjectSummary[]
  /** Open the "New agent session" page of another project, or of no project. */
  onPickProject: (projectId: string) => void
  /** A repo was added as a project from the picker: the projects are to be read again. */
  onProjectAdded: () => void
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
  // The repos a session with no project has as context, until it starts or another project is picked.
  const [repos, setRepos] = useState<PickedRepo[]>([])
  useEffect(() => setRepos([]), [projectId])
  // What the box holds, so another project picked takes the prompt along to its page.
  const typed = useRef('')
  const pickProject = (id: string) => {
    if (id === projectId) return
    if (typed.current.trim()) stashPendingDraft(typed.current)
    onPickProject(id)
  }

  // A host the project's modules bring, picked in "Run on" (a GitHub Actions runner): the start names
  // it by its id, and the daemon starts the run there.
  const host = hostTarget(useRunHosts(noProject ? null : projectId), useSelectedHost())
  // Whether a pull request can be opened here: unknown until the launcher is read, so every pick is
  // offered until then; the daemon that starts the run holds a pull request pick to the branch
  // where its project has no git host.
  const gitHost = launcher?.gitHost ?? true
  // A project with no remote can publish nothing: its picks stop at the commit.
  const remote = launcher?.remote ?? true
  const publishPick = publishPickIn(preferences.publish, gitHost, remote)
  // The branches every project's menu lists, where the pick is offered at all.
  const startFrom = launcher?.startFrom
  const startFromPick = preferences.startFrom?.[projectId]
  const preferencesLoaded = usePreferencesLoaded()
  // The whole map is written: a save names keys, and this is one key. The main branch is the
  // absent entry, so picking it takes the project out.
  const pickStartFrom = (pick: StartFromPick | undefined) => {
    const { [projectId]: _was, ...others } = preferences.startFrom ?? {}
    updatePreferences({ startFrom: pick ? { ...others, [projectId]: pick } : others })
    // The red error may be about the branch just left behind.
    if (error) reset()
  }

  // Where the pull request goes: the picked branch unless the person said main, for that branch; a
  // new pick of the branch to start from starts over. Whether origin has "My local branch" is read
  // from origin, as the branch menu's list is: this clone's copies keep branches origin deleted.
  const [mainFor, setMainFor] = useState<string | null>(null)
  const localOnOrigin = useLoaded<string[] | undefined>(startFrom && startFromPick?.kind === 'local' ? () => onStartBranches(projectId).then(read => read?.branches, () => undefined) : null, undefined, [projectId, startFrom !== undefined, startFromPick?.kind])
  const prBranch = startFrom ? prTargetBranch(startFromPick, startFrom.main, startFrom.local, localOnOrigin) : undefined
  const prInto = prBranch !== undefined && mainFor !== prBranch ? prBranch : undefined
  const prTarget = prBranch !== undefined && startFrom ? { into: prInto ?? startFrom.main, picks: [prBranch, startFrom.main], onPick: (branch: string) => setMainFor(branch === prBranch ? null : prBranch) } : undefined

  // Re-read when the pick changes: `claude` being logged in says nothing about `codex`.
  const driver = preferences.driver
  // Asked again once a press fixed what it said: the agent's own state is followed only while the check says a press can.
  const [recheck, setRecheck] = useState(0)
  const readiness = useLoaded(() => (host ? onStartCheck(projectId, driver, host.id) : onStartCheck(projectId, driver)), null, [projectId, driver, recheck, host?.id])
  const fixable = readiness?.fix !== undefined
  const { state: agent, reload: reloadAgent } = useAgentState(isDriverName(driver) ? driver : undefined, fixable)
  // The project's repository, whose host is where the session pushes.
  const address = launcher?.address
  const wasReady = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    const ready = fixable ? agent?.ready : undefined
    if (wasReady.current === false && ready === true) setRecheck(n => n + 1)
    wasReady.current = ready
  }, [fixable, agent?.ready])

  // The profile the session is on: the saved pick, while there is such a profile; Default otherwise.
  const { view: profilesView } = useProfilesList()
  const onProfile = profilesView?.profiles.find(one => one.id === (preferences.profile ?? DEFAULT_PROFILE)) ?? profilesView?.profiles[0]
  const profileId = onProfile !== undefined && onProfile.id !== DEFAULT_PROFILE ? onProfile.id : undefined
  // The git host account picked for this session, when the person picked one; the profile's, else the computer's, otherwise.
  const [pickedAccount, setPickedAccount] = useState<string | undefined>()
  useEffect(() => setPickedAccount(undefined), [projectId])
  // The plugins this session goes without and the project skills it gets: what its profile starts from, until the person picks.
  const [skillPicks, setSkillPicks] = useState<SkillPicks>(() => profilePicks(onProfile))
  const profileProject = onProfile?.options.skills?.project
  const profileWithout = onProfile?.options.plugins?.without
  useEffect(() => setSkillPicks(profilePicks(onProfile)), [projectId, onProfile?.id, JSON.stringify(profileProject), JSON.stringify(profileWithout)])
  // None left out, and every project skill, are said where the profile names its own: the session's pick goes over the profile's.
  const pickedSkills = {
    ...(skillPicks.without.length > 0 || profileWithout !== undefined ? { pluginsWithout: skillPicks.without } : {}),
    ...(noProject ? {} : skillPicks.project !== undefined ? { projectSkills: skillPicks.project } : profileProject !== undefined && profileProject !== 'all' ? { projectSkills: 'all' as const } : {}),
  }
  const account = useSessionAccount(address, pickedAccount ?? onProfile?.options.github?.account)

  const submit = async (text: string, { images }: { images: string[] }) => {
    setNote(STARTING)
    const { publish: _publish, ...unpublished } = startPicks(preferences)
    const withImages = images.length > 0 ? { images } : {}
    const result = await start(projectId, promptWithContext(text, context), {
      ...withImages,
      ...(noProject ? unpublished : startPicks(preferences)),
      ...(startFrom ? startFromBase(startFromPick, startFrom.main, startFrom.local) : {}),
      ...(prInto !== undefined ? { prBase: prInto } : {}),
      ...(host ? { host: host.id } : {}),
      ...(noProject && repos.length > 0 ? { repos: repos.map(repo => repo.path) } : {}),
      ...(!noProject && remote && account !== undefined ? { account } : {}),
      ...(profileId !== undefined ? { profile: profileId } : {}),
      ...pickedSkills,
    })
    setNote(null)
    if (result) {
      // Show the run in the Runs rail immediately (#405): its tool writes the run's card a beat
      // later, so seed an optimistic row with the typed prompt until the real one takes over.
      // A run on a host carries the host's label, so the view can mark where it executes.
      // What this page says goes with it, for the run's page until the run's record says it.
      const started = startFrom ? (startFromPick?.kind === 'local' ? startFrom.local : startFromPick?.kind === 'published' ? startFromPick.branch : startFrom.main) : undefined
      // The box keeps the words until the move has taken its picture of them; its draft goes with the page.
      void carryBox(() => {
        keepDraft(`launcher:${projectId}`, '')
        keepDraftImages(`launcher:${projectId}`, [])
        onAgentStarted?.(text, result.agentId, host?.label, {
          ...(started !== undefined ? { branch: started } : {}),
          ...(!noProject && remote && account !== undefined ? { gitAccount: account } : {}),
          ...(profileId !== undefined ? { profile: profileId } : {}),
          ...pickedSkills,
          ...(noProject ? {} : { publish: publishPick }),
          ...(prInto !== undefined ? { prBase: prInto } : {}),
          ...(preferences.driver ? { driver: preferences.driver } : {}),
          ...(preferences.model ? { model: preferences.model } : {}),
          ...(preferences.effort ? { effort: preferences.effort } : {}),
          ...withImages,
          ...(noProject && repos.length > 0 ? { repos: repos.map(repo => ({ name: repo.name, from: repo.path })) } : {}),
        }) // select the run we just started (#761)
      }).finally(() => composerRef.current?.clear())
      setRepos([])
      setSkillPicks(profilePicks(onProfile))
    } else setRefused(true)
  }

  const loaded = (label: string, replaced: boolean) => {
    reset()
    setNote(replaced ? `${label} loaded over your draft — undo (${shortcut('Z')}) brings the draft back` : `${label} loaded — review or edit, then Start`)
  }

  return (
    // The width and the padding of an agent's message box (`AgentComposer.tsx`): the box is in the
    // same place on both pages.
    <form onSubmit={e => e.preventDefault()} className="@container mx-auto w-full max-w-3xl px-4 pt-2 pb-4">
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
        // Where the agent starts, above the box after the "Run on" pick: the project, then the branch
        // it starts from. No project word until the name is known, never a wrong one: the row's
        // height is fixed, so the name landing moves nothing. The branch is the row's last, so
        // nothing beside it is pushed when it lands or its words change; it waits for the name,
        // which would otherwise land before it and push it, and for the saved pick, which would
        // otherwise flip its words.
        startsAt={
          <>
            <ProjectPicker look="row" none={{ label: 'No project', tip: 'The session works in a folder of its own' }} picked={noProject ? null : projectId} pickedName={projectName} projects={projects} busy={busy} onPick={id => pickProject(id ?? SESSIONS_ID)} onProjectAdded={onProjectAdded} />
            {/* Repos are folders on this computer, copied into the session's folder. */}
            {noProject && <SessionRepoPicks picked={repos} projects={projects} busy={busy} onChange={setRepos} />}
            {!noProject && projectName && startFrom && preferencesLoaded && <StartFromMenu projectId={projectId} main={startFrom.main} local={startFrom.local} pick={startFromPick} onPick={pickStartFrom} busy={busy} />}
          </>
        }
        // Who runs, under the box at the left (his order): the profile, the skills this session gets, then the Context picker.
        // All three land together once the profiles are read, so the profile's and the skills' landing moves no Context.
        controls={
          profilesView !== undefined && (
          <>
            <ProfileMenu profiles={profilesView.profiles} picked={onProfile?.id} busy={busy} onPick={id => updatePreferences({ profile: id === DEFAULT_PROFILE ? '' : id })} />
            <SkillsMenu projectId={noProject ? undefined : projectId} picks={skillPicks} onChange={setSkillPicks} busy={busy} />
            {!noProject && <ProjectContextMenu projectId={projectId} context={context} busy={busy} onToggle={toggleContext} />}
          </>
          )
        }
        // What becomes of the work, at that row's right, before the model: who it pushes as (the
        // project's git host account, picked for this session), then the "Auto" menu.
        controlsEnd={
          !noProject && (
            <>
              {remote && <GitAccountMenu address={address} busy={busy} picked={pickedAccount} onPick={setPickedAccount} />}
              <AutoMenu publish={publishPick} picks={offeredPublishPicks(gitHost, remote)} onPublish={pick => updatePreferences({ publish: pick })} target={prTarget} busy={busy} />
            </>
          )
        }
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
        notes={
          <>
            {/* A start that hit what the check says says nothing the boxes below do not. */}
            {error && !readiness?.problems.length && <Refusal {...said(error)} />}
            {readiness?.problems.map(problem =>
              problem === readiness.fix?.problem ? (
                <Refusal
                  key={problem}
                  {...(agent && !agent.ready ? { title: agentWords(agent), actions: <AgentFix state={agent} onChanged={() => void reloadAgent()} size="sm" /> } : said(problem))}
                />
              ) : (
                <Refusal key={problem} {...said(problem)} />
              ),
            )}
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
