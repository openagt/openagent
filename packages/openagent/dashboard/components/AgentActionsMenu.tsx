import { useEffect, useRef, useState } from 'react'
import type { GitHostHome, OpenAgentEvent, RepositoryOffer, RecordsReach } from '../../src/index.js'
import { sessionInfo } from '../../src/client.js'
import { MoreVertical, ChevronDown, FolderOpen, Code, Check, ExternalLink, Square, FolderX, Trash2, Copy, CloudUpload, CloudOff, Info, Puzzle } from 'lucide-react'
import { onGitHostHome, onRepositoryOffer } from '../rpc/reads.js'
import { onRecordsReach, sendShareRecords } from '../rpc/projects.js'
import {
  sendOpenInApp,
  sendStop,
  sendRemoveWorktree,
  sendDeleteAgent,
  sendCreateRepository,
} from '../rpc/control.js'
import { useLoaded } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { isAgentActive } from '../lib/live-state.js'
import { describeSessionLink } from '../lib/session-link.js'
import { buildResumeCommand } from '../lib/resume-command.js'
import { buttonVariants } from './ui/button.js'
import { PreferredEditorItems } from './PreferredEditorItems.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { RemoveProjectDialog } from './RemoveProjectDialog.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './ui/dropdown-menu.js'

// The one menu of a page's top bar.
//
// On an agent's page (the menu is given the agent) the agent's name is its button: the name with a small ⌄, opening
// to the session's details, its folder, its editor, the project's page on its git host, its
// session link, the command that resumes it, and Stop, Remove worktree, Delete.
//
// On the "New agent" page there is no session, and a ⋮ holds all of the project's: its git host
// page, its skills, the offer of a repository, where the agents' records go, its folder, its editor.
//
// The handoff's Push / Open PR are not here: they move the work forward, and sit in the bar above
// the message box. The editor keeps its preferred-editor submenu; Delete opens its confirm dialog
// (a menu item cannot also be the dialog's trigger, so the dialog is controlled).
export function AgentActionsMenu({
  projectId,
  agentId: agentId,
  events,
  label,
  retainedWorktree = false,
  onWorktreeRemoved,
  onDeleted,
  onProjectRemoved,
  onOpenSkills,
  details,
  size,
}: {
  projectId: string
  agentId?: string | null | undefined
  events: OpenAgentEvent[]
  /** The session's name: what the session's menu reads. Not known yet, a grey bar holds its place. */
  label?: string | undefined
  retainedWorktree?: boolean
  onWorktreeRemoved?: (() => void) | undefined
  onDeleted?: (() => void) | undefined
  /** Told once the project is off the list; given, the project's menu offers "Remove project". */
  onProjectRemoved?: (() => void) | undefined
  /** Open the list of the project's skills; given, the project's menu offers "Skills…". */
  onOpenSkills?: (() => void) | undefined
  /** The session's details strip under the bar (its coding agent, its spend): the session's menu shows and hides it. */
  details?: { open: boolean; onToggle: () => void } | undefined
  /** The size on disk of the session's worktree, said beside "Remove worktree". */
  size?: string | undefined
}) {
  // Given an agent, this is its page's menu, under the session's name; with none, the ⋮ of a page with no session.
  const session = !!agentId
  const active = isAgentActive(events)
  const info = sessionInfo(events)
  const sessionLink = describeSessionLink(info)

  // Whether this session still has a checkout of its own. A live agent is working in one; a finished
  // run only keeps one while its work has not reached the remote (#737/E5), since that is what
  // teardown waits for before reclaiming it. Without this the folder item promised the session's
  // folder and silently opened the project root instead, because `resolveAgentCheckout` falls back
  // there once the worktree is gone.
  const hasOwnFolder = active || retainedWorktree

  // What to put on the clipboard to pick this session back up in a terminal (#1195). `mkdir -p`
  // leads because the directory is usually gone by the time you want it: the CLI finds a session
  // by the cwd it ran in, so the path has to exist again before `--resume` can see it. Recreating
  // it empty is enough to read the conversation back.
  const resumeCommand = buildResumeCommand(info)
  // Flash a confirmation for a beat, the same feedback the CopyButton gives, since a click that
  // only fills the clipboard has nothing else to show for itself.
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])
  const copyResume = () => {
    if (!resumeCommand) return
    void navigator.clipboard?.writeText(resumeCommand).then(() => {
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    })
  }
  // Hold the last git host page while a new project's loads, so the item does not flicker.
  // Asked again after a repository is created: the project has a page on its git host from then on.
  const [created, setCreated] = useState(0)
  const home = useLoaded<GitHostHome | null>(() => onGitHostHome(projectId), null, [projectId, created], 'previous')
  // A project that lives on this machine only may be offered a repository on a host; the project's
  // menu offers it, a session's does not. Creating one puts the project's code on a server under
  // the person's account, so it is asked once more before it happens.
  const offer = useLoaded<RepositoryOffer | null>(session ? null : () => onRepositoryOffer(projectId), null, [projectId, session, created])
  const [confirmCreate, setConfirmCreate] = useState(false)
  // Where the agents' records go: kept on this machine until the person shares them with the
  // project's remote. The project's menu says which and switches it; sharing pushes a branch, so it
  // is asked once more before it happens. A project with no remote has nothing to switch.
  const [switched, setSwitched] = useState(0)
  const reach = useLoaded<RecordsReach | null>(session ? null : () => onRecordsReach(projectId), null, [projectId, session, created, switched], 'previous')
  const [confirmShare, setConfirmShare] = useState(false)
  // Removing a project takes it off the dashboard's list and deletes nothing in its folder; it is
  // asked once more, and the question says what stays.
  const [confirmRemove, setConfirmRemove] = useState(false)
  const stopSharing = () =>
    void run(() => sendShareRecords(projectId, false), 'Could not stop sharing.').then(outcome => {
      if (outcome.ok) setSwitched(n => n + 1)
    })

  const { busy, error, run } = useAction()

  // A landed Stop stays "Stopping…" until the end event flips `active`, so it can't be re-fired.
  const [stopRequested, setStopRequested] = useState(false)
  useEffect(() => setStopRequested(false), [agentId])
  const stopping = busy || (stopRequested && active)

  const [confirmDelete, setConfirmDelete] = useState(false)

  const openApp = (target: 'files' | 'editor') => run(() => sendOpenInApp(projectId, target, agentId ?? undefined), 'Failed to open.')
  const stopSession = () =>
    void run(() => sendStop(projectId, agentId ?? undefined), 'Could not stop the session.').then(outcome => {
      if (outcome.ok) setStopRequested(true)
    })
  const removeWorktree = () => {
    if (!agentId) return
    void run(() => sendRemoveWorktree(projectId, agentId), 'Could not remove the worktree.').then(outcome => {
      if (outcome.ok) onWorktreeRemoved?.()
    })
  }

  const name = label?.trim() || agentId
  // What the button is called: the menu acts on one session, or, with none, on the project.
  const title = session ? 'Session actions' : 'Project actions'
  const removable = retainedWorktree && !active && !!agentId
  const deletable = !!onDeleted && !active && !!agentId
  // The project's page on its git host: the first item of the project's menu, and in a session's
  // menu after what opens the session's own.
  const homeItem = home && (
    <DropdownMenuItem render={<a href={home.url} target="_blank" rel="noreferrer" />}>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" /> Open on {home.name}
    </DropdownMenuItem>
  )

  return (
    <>
      <DropdownMenu>
        {session ? (
          // The session's name is the menu's button: the name, cut short when the bar is tight, and a
          // small ⌄. A name not known yet is a grey bar in its place, so the bar is laid out the
          // same from the first frame.
          <DropdownMenuTrigger
            type="button"
            aria-label={title}
            title={label}
            className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted data-[popup-open]:bg-muted"
          >
            {label ? <span className="min-w-0 truncate font-medium text-foreground">{label}</span> : <span data-testid="title-placeholder" className="h-3 w-40 max-w-full rounded bg-muted" />}
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  type="button"
                  aria-label={title}
                  className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
                />
              }
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>{title}</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenuContent align={session ? 'start' : 'end'} className="min-w-[14rem]">
          {details && (
            <DropdownMenuItem onClick={details.onToggle}>
              <Info className="h-3.5 w-3.5 shrink-0" /> {details.open ? 'Hide details' : 'Show details'}
            </DropdownMenuItem>
          )}
          {!session && homeItem}
          {/* The door to the project's skills: which it has, and the list to add or remove some. */}
          {onOpenSkills && !session && (
            <DropdownMenuItem onClick={onOpenSkills}>
              <Puzzle className="h-3.5 w-3.5 shrink-0" /> Skills…
            </DropdownMenuItem>
          )}
          {offer && (
            <DropdownMenuItem onClick={() => setConfirmCreate(true)}>
              <CloudUpload className="h-3.5 w-3.5 shrink-0" /> Create a repository on {offer.name}…
            </DropdownMenuItem>
          )}
          {reach === 'kept' && (
            <DropdownMenuItem onClick={() => setConfirmShare(true)}>
              <CloudUpload className="h-3.5 w-3.5 shrink-0" /> Share the agents&rsquo; records to the remote…
            </DropdownMenuItem>
          )}
          {reach === 'origin' && (
            <DropdownMenuItem disabled={busy} onClick={stopSharing}>
              <CloudOff className="h-3.5 w-3.5 shrink-0" /> Stop sharing the agents&rsquo; records
            </DropdownMenuItem>
          )}
          {/* Named for what it actually opens (#1195): once a session's worktree is gone this
              resolves to the project root, and calling that "the session's folder" was a lie the
              user could not see. */}
          <DropdownMenuItem
            disabled={busy}
            onClick={() => void openApp('files')}
            title={agentId && !hasOwnFolder ? 'This session no longer has its own checkout' : undefined}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />{' '}
            {agentId ? (hasOwnFolder ? "Open session's folder" : 'Open project folder') : 'Open folder'}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={busy}>
              <Code className="h-3.5 w-3.5 shrink-0" /> Open in editor
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[15rem]">
              <DropdownMenuItem disabled={busy} onClick={() => void openApp('editor')}>
                <Code className="h-3.5 w-3.5 shrink-0" /> {agentId ? "Open this session's checkout" : 'Open in your editor'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <PreferredEditorItems busy={busy} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {session && homeItem}
          {sessionLink && (
            <DropdownMenuItem render={<a href={sessionLink.href} target="_blank" rel="noreferrer" />}>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" /> {sessionLink.label.replace(' ↗', '')}
            </DropdownMenuItem>
          )}
          {/* The agent's session id (#1195), shown because it is the only handle on the
              conversation once you leave the dashboard, and clickable because on its own an id is
              not actionable: the click copies the command that reopens it in a terminal. Stays
              open on click so the confirmation is visible. */}
          {resumeCommand && info?.sessionId && (
            <DropdownMenuItem closeOnClick={false} onClick={copyResume} title={resumeCommand}>
              {copied ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="flex-1">
                {copied ? 'Copied' : info.workspace ? 'Copy resume command' : 'Copy session id'}
              </span>
              <span className="ml-auto pl-3 font-mono text-[10px] text-muted-foreground">
                {info.sessionId.slice(0, 8)}
              </span>
            </DropdownMenuItem>
          )}

          {/* A rule only above something: a menu with nothing to stop, remove or delete ends on its last item. */}
          {(active || removable || deletable) && <DropdownMenuSeparator />}

          {active && (
            <DropdownMenuItem disabled={stopping} onClick={() => void stopSession()}>
              <Square className="h-3 w-3 shrink-0 fill-current" /> {stopping ? 'Stopping…' : 'Stop agent'}
            </DropdownMenuItem>
          )}

          {removable && (
            <DropdownMenuItem disabled={busy} onClick={() => removeWorktree()}>
              <FolderX className="h-3.5 w-3.5 shrink-0" /> <span className="flex-1">Remove worktree</span>
              {size && <span className="ml-auto pl-3 text-[10px] text-muted-foreground">{size}</span>}
            </DropdownMenuItem>
          )}
          {deletable && (
            <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-danger">
              <Trash2 className="h-3.5 w-3.5 shrink-0" /> Delete session
            </DropdownMenuItem>
          )}

          {/* Last, and apart: the one item of the project's menu that takes something away. */}
          {onProjectRemoved && !session && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setConfirmRemove(true)} className="text-danger">
                <Trash2 className="h-3.5 w-3.5 shrink-0" /> Remove project…
              </DropdownMenuItem>
            </>
          )}

          {error && <p className="px-2 py-1.5 text-xs text-danger">{error}</p>}
        </DropdownMenuContent>
      </DropdownMenu>

      {offer && (
        <ConfirmDialog
          open={confirmCreate}
          onOpenChange={setConfirmCreate}
          title={`Create a private repository on ${offer.name}?`}
          body={
            <>
              This creates the private repository <span className="font-medium text-foreground">{offer.repository}</span> on your{' '}
              {offer.name} account and pushes this project to it. The project&rsquo;s code leaves this machine.
            </>
          }
          confirmLabel="Create and push"
          confirmBusyLabel="Creating…"
          fallbackError="Could not create the repository."
          destructive={false}
          onConfirm={() => sendCreateRepository(projectId)}
          onSuccess={() => setCreated(n => n + 1)}
        />
      )}
      {reach === 'kept' && (
        <ConfirmDialog
          open={confirmShare}
          onOpenChange={setConfirmShare}
          title="Share the agents&rsquo; records to the remote?"
          body={
            <>
              This pushes a branch <span className="font-medium text-foreground">agent-data</span> to this project&rsquo;s remote, and keeps
              pushing as agents work. It holds what you asked each agent and what it answered, under your git email. Everyone
              who can read the remote can read it.
            </>
          }
          confirmLabel="Share"
          confirmBusyLabel="Sharing…"
          fallbackError="Could not share the records."
          destructive={false}
          onConfirm={() => sendShareRecords(projectId, true)}
          onSuccess={() => setSwitched(n => n + 1)}
        />
      )}
      {onProjectRemoved && !session && (
        <RemoveProjectDialog projectId={projectId} open={confirmRemove} onOpenChange={setConfirmRemove} onRemoved={onProjectRemoved} />
      )}
      {onDeleted && agentId && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this agent?"
          body={
            <>
              Deleting <span className="font-medium text-foreground">{name}</span> removes it from the dashboard for good — its
              history can&rsquo;t be recovered. Its branch and any pull request stay in git.
            </>
          }
          confirmLabel="Delete"
          confirmBusyLabel="Deleting…"
          fallbackError="Could not delete the agent."
          onConfirm={() => sendDeleteAgent(projectId, agentId)}
          onSuccess={onDeleted}
        />
      )}
    </>
  )
}
