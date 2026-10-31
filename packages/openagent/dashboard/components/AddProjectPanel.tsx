import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { onCloneTarget, sendAddProject, sendAddProjectFromAddress, sendPickProjectDirectory } from '../rpc/projects.js'
import { useAction } from '../lib/use-action.js'
import { AddProjectEffects } from './AddProjectEffects.js'
import { Button, Input } from '@openagt/skill-ui/module'
import { RadioGroup, RadioGroupOption } from './ui/radio-group.js'

// Add a project (#396/#1150): the OS's own folder picker instead of a typed path — the daemon
// opens the dialog (a browser page cannot learn an absolute path from a picker of its own) and
// hands the choice back, the user confirms they trust the repo, and the daemon installs and
// registers it. Opened as a small modal from the projects picker and the onboarding checklist.
// The checklist may hand it the folder the dashboard runs in: then there is nothing to pick.
//
// Before the add, the person also says where the agents' records go: kept on this machine, which
// is what is picked until they pick the other, or shared to the repository's remote. Nothing is
// pushed for a project added with the first.
//
// The second way in is the repository's address, for a computer that does not have the folder: a
// server has no screen for a folder dialog and no folder to pick. The person types the address,
// sees where the project will be cloned to, confirms the same trust question, and only then is
// anything cloned. A computer whose folder dialog cannot open offers this way in its place.
//
// It behaves like the dialog it claims to be (#948): Esc closes, Tab stays inside, focus
// returns to the opener on close.
export function AddProjectPanel({
  folder,
  fromAddress = false,
  onAdded,
  onClose,
}: {
  folder?: string | undefined
  /** Opened to add a project by its repository's address: no folder dialog. */
  fromAddress?: boolean
  onAdded: () => void
  onClose: () => void
}) {
  // The picked path, once the system dialog answered; the phases are picking (no path yet),
  // confirming trust (path, not added), and done (added set).
  const [path, setPath] = useState<string | null>(folder ?? null)
  // The other way: by address. `typed` is what the field holds; `target` is that address once
  // OpenAgent has said where it would clone it to, which is what the trust question shows.
  const [byAddress, setByAddress] = useState(fromAddress)
  const [typed, setTyped] = useState('')
  const [target, setTarget] = useState<{ typed: string; address: string; path: string } | null>(null)
  const [share, setShare] = useState(false)
  const recordsLabel = useId()
  const [added, setAdded] = useState<{ alreadyActivated: boolean; noRemote: boolean; path?: string } | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const { busy, error, reset, run } = useAction()
  const panelRef = useRef<HTMLDivElement>(null)

  // Give focus back to the control that opened the dialog (the picker's Add item is gone by
  // then, so its trigger is the stable target).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => opener?.focus()
  }, [])

  // The system dialog opens with the modal: picking the folder IS the form. A dismissed dialog
  // closes the modal too — the user said "not now" once already.
  const pick = async () => {
    setPickError(null)
    const picked = await sendPickProjectDirectory().catch(() => ({ ok: false as const, error: 'Could not reach the daemon.' }))
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
    const timer = setTimeout(onClose, added.noRemote || added.path ? 6000 : 2500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [added])

  // The address as typed -> where it would be cloned to, or why it is no address. Nothing is cloned yet.
  const readAddress = async (event: FormEvent) => {
    event.preventDefault()
    const address = typed.trim()
    if (busy || !address) return
    const outcome = await run(() => onCloneTarget(address), 'Could not reach the daemon.')
    if (outcome.ok) setTarget({ typed: address, address: outcome.value.address, path: outcome.value.path })
  }

  // Trust confirmed (#439) -> install + register; by address, clone first.
  const confirmAdd = async () => {
    if (busy || (!path && !target)) return
    const outcome = await run(() => (target ? sendAddProjectFromAddress(target.typed, share) : sendAddProject(path!, share)), 'Failed to add the project.')
    if (outcome.ok) {
      setAdded({ alreadyActivated: outcome.value.alreadyActivated, noRemote: outcome.value.noRemote === true, ...(outcome.value.path ? { path: outcome.value.path } : {}) })
      onAdded()
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onKeyDown={onKeyDown}>
      {/* Click-away closes, same as dismissing the dropdown it was opened from. */}
      <div className="absolute inset-0" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        className="relative w-96 max-w-[90vw] rounded-lg border border-border bg-background p-4 shadow-lg"
      >
        {added ? (
          <>
            <p role="status" className="mb-3 text-sm font-medium">
              {added.alreadyActivated ? 'Already added' : 'Project added'}
            </p>
            {/* Sharing was picked and there is nothing to share with: said, not dropped. */}
            {added.noRemote && <p className="mb-3 text-xs text-muted-foreground">This repository has no remote, so the agents&rsquo; records stay on this machine.</p>}
            {added.path && (
              <p className="mb-3 break-all text-xs text-muted-foreground">
                It is in <code className="rounded bg-muted px-1">{added.path}</code>.
              </p>
            )}
            <div className="flex justify-end">
              <Button type="button" size="sm" autoFocus onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : byAddress && !target ? (
          <form onSubmit={event => void readAddress(event)}>
            <p className="mb-2 text-sm font-medium">Add project from a GitHub address</p>
            {/* Why the person is here when they asked for the folder dialog. */}
            {pickError && <p className="mb-2 text-xs text-muted-foreground">{pickError}</p>}
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="add-project-address">
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
              className="mb-2 h-8 bg-background px-2 font-mono text-xs"
            />
            <p className="mb-3 text-xs text-muted-foreground">It is cloned into the projects folder of this computer, with the logins this computer has.</p>
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !typed.trim()}>
                Next
              </Button>
            </div>
          </form>
        ) : pickError ? (
          <>
            <p className="mb-2 text-sm font-medium">Add project</p>
            <p className="mb-3 text-xs text-danger">{pickError}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setByAddress(true)}>
                Add from a GitHub address
              </Button>
              <Button type="button" size="sm" onClick={() => void pick()}>
                Try again
              </Button>
            </div>
          </>
        ) : path || target ? (
          // The trust confirmation (#439): a plain-language prompt-injection warning before adding.
          <>
            <p className="mb-2 text-sm font-medium">Do you trust this repository?</p>
            <p className="mb-2 break-all text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1">{target ? target.address : path}</code>
            </p>
            {target && (
              <p className="mb-2 break-all text-xs text-muted-foreground">
                It will be cloned to <code className="rounded bg-muted px-1">{target.path}</code>.
              </p>
            )}
            <p className="mb-3 text-xs text-muted-foreground">
              Adding it lets the agent read its files. Hidden instructions in an untrusted repo can hijack the agent
              (prompt injection), so only add repos you trust.
            </p>
            <div className="mb-3">
              <AddProjectEffects />
            </div>
            {/* One group with one name: the radio group is named by the line above it. */}
            <div className="mb-3 text-xs">
              <p id={recordsLabel} className="mb-1 font-medium text-foreground">
                The agents&rsquo; records (what you ask, what each agent answers)
              </p>
              <RadioGroup aria-labelledby={recordsLabel} value={share ? 'share' : 'keep'} disabled={busy} onValueChange={next => setShare(next === 'share')} className="gap-1.5">
                <RadioGroupOption value="keep" className="flex-nowrap items-start text-xs [&>[data-slot=radio-group-item]]:mt-0.5">
                  <span>
                    Keep them on this machine
                    <span className="block text-muted-foreground">Nothing is pushed.</span>
                  </span>
                </RadioGroupOption>
                <RadioGroupOption value="share" className="flex-nowrap items-start text-xs [&>[data-slot=radio-group-item]]:mt-0.5">
                  <span>
                    Share them to the repository&rsquo;s remote
                    <span className="block text-muted-foreground">
                      Pushes a branch <code className="rounded bg-muted px-1">agent-data</code> to origin, and keeps pushing as agents work.
                    </span>
                  </span>
                </RadioGroupOption>
              </RadioGroup>
              <p className="mt-1 text-muted-foreground">You can change this later in the project&rsquo;s menu.</p>
            </div>
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  reset()
                  if (target) setTarget(null)
                  else if (folder) onClose()
                  else void pick()
                }}
              >
                {target ? 'Change the address' : folder ? 'Cancel' : 'Choose again'}
              </Button>
              <Button type="button" size="sm" autoFocus disabled={busy} onClick={() => void confirmAdd()}>
                {busy ? (target ? 'Cloning…' : 'Adding…') : target ? 'I trust it, clone and add it' : 'I trust it, add it'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium">Add project</p>
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              Choose the repository&apos;s folder in the system dialog…
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
