import { buttonVariants } from './ui/button.js'
import { inPlace } from '../lib/in-place.js'
import { Page } from './Page.js'

// What a URL that no longer resolves renders (#784). Now that a session is a link you can bookmark
// and paste, the link outlives the thing: a removed worktree, a project dropped from the registry.
// Say so and offer the way back, rather than silently redirecting — a redirect looks like the link
// worked and you clicked the wrong one. In the frame every page has, from its top, so nothing moves
// once it is drawn: its name, the one sentence, and the way back as a link.
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
    <Page title={title} description={detail}>
      <a href={href} onClick={inPlace(onAction)} className={buttonVariants({ variant: 'link' })}>
        {actionLabel}
      </a>
    </Page>
  )
}
