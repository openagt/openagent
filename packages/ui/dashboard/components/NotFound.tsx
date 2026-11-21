import { ChevronLeft } from 'lucide-react'
import { buttonVariants } from './ui/button.js'
import { inPlace } from '../lib/in-place.js'
import { cn } from '../lib/utils.js'
import { Page } from './Page.js'

// What a URL that no longer resolves renders (#784). Now that a session is a link you can bookmark
// and paste, the link outlives the thing: a removed worktree, a project dropped from the registry.
// Say so and offer the way back, rather than silently redirecting — a redirect looks like the link
// worked and you clicked the wrong one. In the frame every page has, from its top, so nothing moves
// once it is drawn: its name, the one sentence, and the way back as a press that is a link. The
// sentence is the page's whole content, so a phone shows it too, where a page's description is said
// to a screen reader only.
export function NotFound({
  title,
  detail,
  actionLabel,
  href,
  onAction,
}: {
  title: string
  detail: string
  actionLabel: string
  /** Where the way back goes: a link, which also opens in a new tab. */
  href: string
  onAction: () => void
}) {
  return (
    <Page title={title} line={detail}>
      {/* Its words and its chevron 12 and 8 in, as a secondary press's are; the press starts on the title's edge. */}
      <a href={href} onClick={inPlace(onAction)} className={cn(buttonVariants({ variant: 'secondary' }), 'pl-2 max-md:h-11')}>
        <ChevronLeft className="size-4" aria-hidden />
        {actionLabel}
      </a>
    </Page>
  )
}
