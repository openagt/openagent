import { Button } from './ui/button.js'

// What a URL that no longer resolves renders (#784). Now that a session is a link you can bookmark
// and paste, the link outlives the thing: a removed worktree, a project dropped from the registry.
// Say so and offer the way back, rather than silently redirecting — a redirect looks like the link
// worked and you clicked the wrong one.
export function NotFound({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string
  detail: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{detail}</p>
      <Button variant="outline" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  )
}
