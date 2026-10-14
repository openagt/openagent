import { DiffStat, PreviewCard, useModuleHost, usePolled } from '@openagt/dashboard/module'
import type { FileContent } from '../src/read.js'
import type { FileDiff } from '../src/diff.js'
import { readContent, readDiff } from './reads.js'
import { ContentView, DiffView } from './DiffView.js'

// Hover a file in the tree, see what is in it. Clicking is already taken — it toggles the path in
// the agent Context (#504) — so hover is the free gesture. Base UI's PreviewCard is the hover-card
// primitive: it holds open while the pointer travels into the card, so a long body stays scrollable.
//
// A changed file shows its diff (#816), an unchanged one its contents (#828). The tree already
// holds each file's status, so `changed` picks the read here rather than the server looking the
// status up again. Both reads resolve the selected agent's worktree (#815).
//
// The card is its own component because a closed PreviewCard does not mount its popup: mounting
// *is* opening, so the read is lazy by construction (nothing is fetched for the files you never
// point at) with no open-state bookkeeping.

/** A diff and a file body arrive on the same channel; only the diff carries a patch. */
function isDiff(value: FileDiff | FileContent): value is FileDiff {
  return 'patch' in value
}

export function FilePreviewCard({
  projectId,
  agentId: agentId,
  path,
  changed = true,
  commit,
}: {
  projectId: string
  agentId?: string | null | undefined
  path: string
  /** The tree saw a git status for this file, so there is a diff rather than only contents. */
  changed?: boolean
  /** One commit of the run's work: the diff is then what that commit alone changed in the file. */
  commit?: string | undefined
}) {
  // Polled, not read once: the card is open over a session that is still editing, so what is under
  // the pointer keeps up rather than freezing at whatever it was when you hovered.
  const host = useModuleHost()
  const { value, loaded } = usePolled<FileDiff | FileContent | null>(
    () =>
      changed
        ? readDiff(host, projectId, path, agentId ?? undefined, commit)
        : readContent(host, projectId, path, agentId ?? undefined),
    null,
    5_000,
    [projectId, agentId, path, changed, commit],
  )

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{path}</span>
        {value && isDiff(value) && <DiffStat added={value.added} removed={value.removed} className="ml-auto" />}
      </header>
      {!loaded ? (
        <p className="p-2 text-xs text-muted-foreground">{changed ? 'Reading the diff…' : 'Reading the file…'}</p>
      ) : !value ? (
        <p className="p-2 text-xs text-muted-foreground">{changed ? 'No change to show.' : 'Nothing to show.'}</p>
      ) : isDiff(value) ? (
        <DiffView diff={value} className="py-1" />
      ) : (
        <ContentView content={value} className="py-1" />
      )}
    </>
  )
}

export function FilePreviewHover({
  projectId,
  agentId: agentId,
  path,
  changed = true,
  children,
}: {
  projectId: string
  agentId?: string | null | undefined
  path: string
  changed?: boolean
  children: React.ReactNode
}) {
  return (
    <PreviewCard.Root>
      {/* The tree's rows are `pointer-events-none` so only the label is clickable; the trigger has
          to take them back, or there is nothing to hover. */}
      <PreviewCard.Trigger delay={350} closeDelay={150} render={<div className="pointer-events-auto" />}>
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        {/* The layer is the positioner's, as every popup's is: on the popup inside it, it would count for nothing against the page. */}
        <PreviewCard.Positioner side="left" align="start" sideOffset={8} className="z-50">
          <PreviewCard.Popup className="flex max-h-[70vh] w-[42rem] max-w-[80vw] flex-col overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-lg">
            <FilePreviewCard projectId={projectId} agentId={agentId} path={path} changed={changed} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}
