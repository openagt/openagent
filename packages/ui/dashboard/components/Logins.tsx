import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { CopyButton } from './ui/copy-button.js'

// The pieces a press that fixes a login is drawn with, the same wherever a module draws one: a
// package's logo, the command a press runs, the press with what it is doing and why it failed, and
// a program's words with their addresses as links.

/** A package's logo, an SVG it gave: drawn as a mask in the text's colour, never put in the page as markup. */
export function PackageLogo({ svg, className }: { svg: string | undefined; className?: string }) {
  if (!svg) return <span aria-hidden className={cn('size-4 shrink-0 rounded-sm bg-muted-foreground/30', className)} />
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  return <span aria-hidden className={cn('size-4 shrink-0 bg-current', className)} style={{ maskImage: url, WebkitMaskImage: url, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }} />
}

/**
 * The command a press runs, under its button, so the person sees what is done on their computer: one line, which scrolls sideways when it
 * is longer than its room. On a phone the copy press is a finger's size, its glyph 16 in from the right: the command starts 16 in too.
 */
export function CommandLine({ command }: { command: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 max-md:pl-4">
      {/* Where it has no room it ends with "…" on a whole character, and scrolls to its end. */}
      <code className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-xs text-ellipsis whitespace-nowrap text-muted-foreground">{command}</code>
      <CopyButton text={command} label="Copy the command" className="justify-center md:size-6 max-md:size-11" />
    </div>
  )
}

/** How a fix's press is drawn: the page's primary by default, or a quieter press beside another's. */
export type FixVariant = 'secondary' | undefined

/** A press that fixes one thing: its button, what it is doing while it does, the command it runs, why it failed. */
export function FixAction({ label, busy, busyWords, command, failed, onPress, size = 'default', variant }: { label: string; busy: boolean; busyWords: string; command?: string; failed?: string; onPress: () => void; size?: 'default' | 'sm' | undefined; variant?: FixVariant }) {
  return (
    <div className="min-w-0 space-y-2">
      {/* The command beside its press where both fit, so the two take one line. Busy, the press stays with the focus it
          was pressed with, and says it is waiting under it. On a phone the page's press is a finger's 44, as a form's foot is. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size={size} variant={variant} loading={busy} onClick={onPress} className={cn(size === 'default' && 'max-md:h-11')}>
          {label}
        </Button>
        {command && <CommandLine command={command} />}
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {busyWords}
        </p>
      )}
      {failed && (
        <p role="alert" className="whitespace-pre-line text-xs text-danger">
          <Linked text={failed} />
        </p>
      )}
    </div>
  )
}

/** A program's words, each address in them a link: a sign-in page it names is opened from here. */
export function Linked({ text }: { text: string }) {
  return text.split(/(https?:\/\/[^\s<>"]+)/).map((part, at) =>
    at % 2 === 1 ? (
      <a key={at} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {part}
      </a>
    ) : (
      part
    ),
  )
}
