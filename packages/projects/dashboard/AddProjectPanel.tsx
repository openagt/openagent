import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { BACKDROP_CLASS, Button, cn, DIALOG_POPUP_CLASS, DIALOG_PRESSES_CLASS, Input, PathStrip, projectsChanged, useAction, useModuleHost } from '@openagt/ui/module'
import { addFromAddress, addProject, cloneTargetFor, pickDirectory } from './calls.js'
import { AddProjectEffects } from './AddProjectEffects.js'

/** The dialog's title, as every dialog's. */
const TITLE = 'mb-3 text-base font-semibold'
/** Its presses, under what it says, primary last. */
const PRESSES = cn('mt-6 flex gap-2', DIALOG_PRESSES_CLASS)

// Add a project (#396/#1150): the OS's own folder picker instead of a typed path — the module's
// server opens the dialog (a browser page cannot learn an absolute path from a picker of its own)
// and hands the choice back, the user confirms they trust the repo, and the server installs and
// lists it. Opened as a small modal from the project picker, where a repo on this computer hands
// it its folder: then there is nothing to pick.
//
// The question is short: who adds a project wants it added. The agents' records stay on this
// machine; the project's Agent data page shares them later.
//
// The second way in is the repository's address, for a computer that does not have the folder: a
// server has no screen for a folder dialog and no folder to pick. The person types the address,
// sees where the project will be cloned to, confirms the same trust question, and only then is
// anything cloned. A computer whose folder dialog cannot open offers this way in its place. The
// project picker hands the address typed into its search: then it opens at the trust question.
//
// It behaves like the dialog it claims to be (#948): Esc closes, Tab stays inside, focus
// returns to the opener on close.
export function AddProjectPanel({
  folder,
  address,
  fromAddress = address !== undefined,
  opener,
  effects = false,
  onAdded,
  onClose,
}: {
  folder?: string | undefined
  /** The repository's address, typed already: read at once, so the trust question is the first thing shown. */
  address?: string | undefined
  /** Opened to add a project by its repository's address: no folder dialog. */
  fromAddress?: boolean
  /** The control that opened it, given focus back when it closes: the menu it was picked in is gone by then. */
  opener: RefObject<HTMLElement | null>
  /** Say, under the trust question, what adding a project does to its folder: for a person adding their first. */
  effects?: boolean
  /** The project was added: its folder, for the picker to pick it once the projects are read again. */
  onAdded: (path: string) => void
  onClose: () => void
}) {
  // The picked path, once the system dialog answered; the phases are picking (no path yet),
  // confirming trust (path, not added), and done (added set).
  const [path, setPath] = useState<string | null>(folder ?? null)
  // The other way: by address. `typed` is what the field holds; `target` is that address once
  // OpenAgent has said where it would clone it to, which is what the trust question shows.
  const [byAddress, setByAddress] = useState(fromAddress)
  const [typed, setTyped] = useState(address ?? '')
  const [target, setTarget] = useState<{ typed: string; address: string; path: string } | null>(null)
  const [added, setAdded] = useState<{ alreadyActivated: boolean; path?: string } | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const { busy, error, reset, run } = useAction()
  const panelRef = useRef<HTMLDivElement>(null)
  const host = useModuleHost()

  // Closed, it hands the keyboard back to the control that opened it, unless the person has it
  // elsewhere by then: a project just added opens on its message box, which takes the caret, and
  // what is typed there while this still says "Project added" goes on there once this closes itself.
  // The panel is off the page by now, so a keyboard that was in it is on the page's body.
  useEffect(
    () => () => {
      if (document.activeElement === null || document.activeElement === document.body) opener.current?.focus()
    },
    [opener],
  )

  // The system dialog opens with the modal: picking the folder IS the form. A dismissed dialog
  // closes the modal too — the user said "not now" once already.
  const pick = async () => {
    setPickError(null)
    const picked = await pickDirectory(host).catch(() => ({ ok: false as const, error: 'Could not reach the daemon.' }))
    if (!picked.ok) {
      setPickError(picked.error)
      return
    }
    if (!picked.path) {
      onClose()
      return
    }
    reset()
    setPath(picked.path)
  }
  useEffect(() => {
    if (!folder && !fromAddress) void pick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-close a beat after success; Done closes sooner.
  useEffect(() => {
    if (!added) return
    // Longer when there is something to read: where a cloned project went.
    const timer = setTimeout(onClose, added.path ? 6000 : 2500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [added])

  // The address as typed -> where it would be cloned to, or why it is no address. Nothing is cloned yet.
  const readAddress = async (event?: FormEvent) => {
    event?.preventDefault()
    const address = typed.trim()
    if (busy || !address) return
    const outcome = await run(() => cloneTargetFor(host, address), 'Could not reach the daemon.')
    if (outcome.ok) setTarget({ typed: address, address: outcome.value.address, path: outcome.value.path })
  }
  useEffect(() => {
    if (address !== undefined) void readAddress()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Trust confirmed (#439) -> install + register; by address, clone first.
  const confirmAdd = async () => {
    if (busy || (!path && !target)) return
    const outcome = await run(() => (target ? addFromAddress(host, target.typed) : addProject(host, path!)), 'Failed to add the project.')
    if (outcome.ok) {
      projectsChanged({ added: true })
      setAdded({ alreadyActivated: outcome.value.alreadyActivated, ...(outcome.value.path ? { path: outcome.value.path } : {}) })
      onAdded(outcome.value.path ?? path!)
    }
  }

  // The dialog contract: Esc closes; Tab cycles inside rather than escaping to the page.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter(
      el => !el.hasAttribute('disabled'),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // On the page's body: opened from a control inside a form (the launcher's), its own form would be
  // nested in that one, and a press of its Next would send the page's.
  return createPortal(
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      {/* Click-away closes, same as dismissing the dropdown it was opened from. */}
      <div className={BACKDROP_CLASS} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        data-overlay="dialog"
        aria-modal="true"
        aria-label="Add project"
        className={cn(DIALOG_POPUP_CLASS, 'md:w-[min(28rem,calc(100vw-2rem))]')}
      >
        {added ? (
          <>
            <p role="status" className={TITLE}>
              {added.alreadyActivated ? 'Already added' : 'Project added'}
            </p>
            {added.path && (
              <p className="text-sm text-muted-foreground">
                It is in <PathStrip path={added.path} />.
              </p>
            )}
            <div className={cn(PRESSES, 'justify-end')}>
              <Button type="button" autoFocus onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : byAddress && !target ? (
          <form onSubmit={event => void readAddress(event)}>
            <p className={TITLE}>Add project from a GitHub address</p>
            {/* Why the person is here when they asked for the folder dialog. */}
            {pickError && <p className="mb-3 text-sm text-muted-foreground">{pickError}</p>}
            <label className="mb-2 block text-sm text-muted-foreground" htmlFor="add-project-address">
              The repository&rsquo;s address. Any git host works.
            </label>
            <Input
              id="add-project-address"
              autoFocus
              value={typed}
              disabled={busy}
              onChange={event => setTyped(event.target.value)}
              placeholder="github.com/you/project"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="font-mono"
            />
            <p className="mt-2 text-sm text-muted-foreground">It is cloned into the projects folder of this computer, with the logins this computer has.</p>
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <div className={cn(PRESSES, 'justify-end')}>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!typed.trim()}>
                Next
              </Button>
            </div>
          </form>
        ) : pickError ? (
          <>
            <p className={TITLE}>Add project</p>
            <p className="text-sm text-danger">{pickError}</p>
            <div className={cn(PRESSES, 'flex-wrap justify-end')}>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={() => setByAddress(true)}>
                Add from a GitHub address
              </Button>
              <Button type="button" onClick={() => void pick()}>
                Try again
              </Button>
            </div>
          </>
        ) : path || target ? (
          // The trust confirmation (#439): a plain-language prompt-injection warning before adding.
          <>
            <p className={TITLE}>Do you trust this repository?</p>
            <p className="flex">
              <PathStrip path={target ? target.address : path!} />
            </p>
            {target && (
              <p className="mt-2 text-sm text-muted-foreground">
                It will be cloned to <PathStrip path={target.path} />.
              </p>
            )}
            <p className="mt-3 text-sm text-foreground">
              Agents will read its files. Hidden instructions in a repository can take over an agent, so add only the
              ones you trust.
            </p>
            {effects && (
              <div className="mt-3">
                <AddProjectEffects />
              </div>
            )}
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <div className={cn(PRESSES, 'justify-end')}>
              {/* A question about trust opens on the press that adds nothing: a second Enter, meant for the picker, trusts no repository unread. */}
              <Button
                type="button"
                variant="secondary"
                autoFocus
                loading={busy}
                onClick={() => {
                  reset()
                  if (target) setTarget(null)
                  else if (folder) onClose()
                  else void pick()
                }}
              >
                {target ? 'Change the address' : folder ? 'Cancel' : 'Choose again'}
              </Button>
              <Button type="button" loading={busy} onClick={() => void confirmAdd()}>
                {busy ? (target ? 'Cloning…' : 'Adding…') : target ? 'I trust it, clone and add it' : 'I trust it, add it'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={TITLE}>Add project</p>
            <p role="status" className="text-sm text-muted-foreground">
              Choose the repository&apos;s folder in the system dialog…
            </p>
            <div className={cn(PRESSES, 'justify-end')}>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
