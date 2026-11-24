import { SESSIONS_ID } from '../../src/project-address.js'
import { useContext, useEffect, useRef, useState } from 'react'
import type { GitHostHome, RepositoryOffer } from '../../src/index.js'
import type { RunEvent } from '@openagt/hooks'
import { sessionInfo } from '../../src/client.js'
import { RevealedTitle } from './RevealedTitle.js'
import { MoreVertical, ChevronDown, FolderOpen, Code, Check, ExternalLink, Square, Trash2, Copy, CloudUpload, Info } from 'lucide-react'
import { onGitHostHome, onRepositoryOffer } from '../rpc/reads.js'
import {
  sendOpenInApp,
  sendDeleteAgent,
  sendCreateRepository,
} from '../rpc/control.js'
import { useLoaded } from '../lib/use-async.js'
import { buttonVariants } from './ui/button.js'
import { useAction } from '../lib/use-action.js'
import { useStop } from '../lib/use-stop.js'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { cn } from '../lib/utils.js'
import { describeSessionLink } from '../lib/session-link.js'
import { PreferredEditorItems } from './PreferredEditorItems.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { useMenuActions } from './Places.js'
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

// The menus of a page's top bar.
//
// Given an agent, the agent's name is its button: the name with a small ⌄, opening to the session's
// details, its folder, its editor, the project's page on its git host, its session link, the command
// that resumes it, the modules' items (git-branches' Remove worktree), and Stop, Delete.
//
// Given none, a ⋮ holds all of the project's: its git host page, its skills, the offer of a
// repository, where the agents' records go, its folder, its editor. It stands in the same place on
// the "New agent session" page and on an agent's page (ProjectMenu).
//
// The handoff's Push / Open PR are not here: they move the work forward, and sit in the bar above
// the message box. The editor keeps its preferred-editor submenu; Delete opens its confirm dialog
// (a menu item cannot also be the dialog's trigger, so the dialog is controlled).
export function AgentActionsMenu({
  projectId,
  agentId,
  events,
  live = false,
  label,
  naming = false,
  retainedWorktree = false,
  onDeleted,
  details,
  resumeCommand,
}: {
  projectId: string
  agentId?: string | null | undefined
  events: RunEvent[]
  /** The run works, as its page knows it: before its feed shows the leg a message continued it with, too. */
  live?: boolean
  /** The session's name: what the session's menu reads. Not known yet, a grey bar holds its place. */
  label?: string | undefined
  /** The session's name is still coming (a run just started): when it arrives it comes in letter by letter. A name that was only slow to load comes in plain. */
  naming?: boolean
  retainedWorktree?: boolean
  onDeleted?: (() => void) | undefined
  /** The session's details strip under the bar (its coding agent, its spend): the session's menu shows and hides it. */
  details?: { open: boolean; onToggle: () => void } | undefined
  /** The command that picks the session's agent session back up in a terminal, as its coding agent says it (#1195); none where it has none. */
  resumeCommand?: string | undefined
}) {
  // Given an agent, this is its page's menu, under the session's name; with none, the ⋮ of a page with no session.
  const session = !!agentId
  const info = sessionInfo(events)
  const sessionLink = describeSessionLink(info)

  // Whether this session still has a checkout of its own. A live agent is working in one; a finished
  // run only keeps one while its work has not reached the remote (#737/E5), since that is what
  // teardown waits for before reclaiming it. Without this the folder item promised the session's
  // folder and silently opened the project root instead, because `resolveAgentCheckout` falls back
  // there once the worktree is gone.
  const hasOwnFolder = live || retainedWorktree

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
  // Remembered per project, under the key a session's page reads: a run started here finds it there at once.
  // Asked again after a repository is created: the project has a page on its git host from then on.
  const [created, setCreated] = useState(0)
  const home = useLoaded<GitHostHome | null>(() => onGitHostHome(projectId), null, [projectId, created], { remember: `git-host-home:${projectId}` })
  // A project that lives on this machine only may be offered a repository on a host; the project's
  // menu offers it, a session's does not. Creating one puts the project's code on a server under
  // the person's account, so it is asked once more before it happens.
  const offer = useLoaded<RepositoryOffer | null>(session ? null : () => onRepositoryOffer(projectId), null, [projectId, session, created])
  const [confirmCreate, setConfirmCreate] = useState(false)
  // Removing a project takes it off the dashboard's list and deletes nothing in its folder; it is
  // asked once more, and the question says what stays.

  // Per session, as in the composer: the page keeps this menu from one session to the next, and an answer is the session's it was pressed in.
  const { busy, error, run } = useAction(agentId ?? '')

  // The message box's Stop and this one are one press (`use-stop.ts`).
  const { stopping, error: stopError, stop: stopSession } = useStop(projectId, agentId ?? undefined, live)
  // OpenAgent is not answering: Stop cannot reach the agent, here as in the composer.
  const down = useContext(DaemonDown)

  const [confirmDelete, setConfirmDelete] = useState(false)

  const openApp = (target: 'files' | 'editor') => run(() => sendOpenInApp(projectId, target, agentId ?? undefined), 'Failed to open.')

  // A name the run was being given comes in letter by letter, as the session's row in the list does.
  // Per session: the next one opened has a name of its own, and was not waited for because this one's was.
  const waited = useRef<{ agent: string | null | undefined; naming: boolean }>({ agent: agentId, naming: false })
  if (waited.current.agent !== agentId) waited.current = { agent: agentId, naming: false }
  if (naming) waited.current.naming = true
  const name = label?.trim() || agentId
  // What the button is called: the menu acts on one session, or, with none, on the project.
  const title = session ? 'Session actions' : 'Project actions'
  const deletable = !!onDeleted && !live && !!agentId
  // The project's page on its git host: the first item of the project's menu, and in a session's
  // menu after what opens the session's own.
  const homeItem = home && (
    <DropdownMenuItem render={<a href={home.url} target="_blank" rel="noreferrer" />}>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" /> Open on {home.name}
    </DropdownMenuItem>
  )
  // What the modules offer in the session's menu (`chat.menu`), or in the project's (`project.menu`), asked again as it opens.
  const [open, setOpen] = useState(false)
  const offered = useMenuActions(session ? 'chat.menu' : 'project.menu', session ? { projectId, agentId: agentId! } : projectId !== SESSIONS_ID ? { projectId } : null, projectId, open)

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        {session ? (
          // The session's name is the menu's button: the name, cut short when the bar is tight, and a
          // small ⌄. A name not known yet is a grey bar in its place, so the bar is laid out the
          // same from the first frame.
          <DropdownMenuTrigger
            type="button"
            aria-label={label ? `${label}, ${title.toLowerCase()}` : title}
            title={label}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'min-w-0 shrink justify-start gap-1 text-left data-[popup-open]:bg-accent')}
          >
            {label ? (
              <span className="min-w-0 truncate text-foreground">
                <RevealedTitle key={label} text={label} start={waited.current.naming} />
              </span>
            ) : <span data-testid="title-placeholder" className="h-3 w-40 max-w-full rounded-sm bg-muted" />}
            <ChevronDown className="size-3 shrink-0 text-faint-foreground" aria-hidden />
          </DropdownMenuTrigger>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  type="button"
                  aria-label={title}
                  className={cn(buttonVariants({ variant: 'ghost', size: 'icon-bar' }), 'text-muted-foreground data-[popup-open]:bg-accent')}
                />
              }
            >
              <MoreVertical className="size-4" />
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
          {offer && (
            <DropdownMenuItem onClick={() => setConfirmCreate(true)}>
              <CloudUpload className="h-3.5 w-3.5 shrink-0" /> Create a repository on {offer.name}…
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
              <DropdownMenuItem
                disabled={busy}
                onClick={() => void openApp('editor')}
                title={agentId && !hasOwnFolder ? 'This session no longer has its own checkout' : undefined}
              >
                <Code className="h-3.5 w-3.5 shrink-0" /> {agentId ? (hasOwnFolder ? "Open this session's checkout" : 'Open the project') : 'Open in your editor'}
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
                {copied ? 'Copied' : 'Copy resume command'}
              </span>
              <span className="ml-auto pl-3 font-mono text-xs text-muted-foreground">
                {info.sessionId.slice(0, 8)}
              </span>
            </DropdownMenuItem>
          )}

          {offered.items}

          {/* A rule only above something: a menu with nothing to stop or delete ends on its last item. */}
          {(live || deletable) && <DropdownMenuSeparator />}

          {live && (
            <DropdownMenuItem disabled={stopping || down} onClick={stopSession}>
              <Square className="h-3 w-3 shrink-0 fill-current" /> {stopping ? 'Stopping…' : 'Stop agent'}
            </DropdownMenuItem>
          )}

          {deletable && (
            <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-danger">
              <Trash2 className="h-3.5 w-3.5 shrink-0" /> Delete session…
            </DropdownMenuItem>
          )}

          {(error ?? stopError) && <p className="px-2 py-1.5 text-xs text-danger">{error ?? stopError}</p>}
        </DropdownMenuContent>
      </DropdownMenu>

      {offered.overlay}
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
      {onDeleted && agentId && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this session?"
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
