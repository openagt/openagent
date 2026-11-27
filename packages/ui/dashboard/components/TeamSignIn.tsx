import { useCallback, useEffect, useRef } from 'react'
import { CircleAlert, Loader2 } from 'lucide-react'
import { Logo } from './Logo.js'
import { Button, buttonVariants } from './ui/button.js'
import { cn } from '../lib/utils.js'
import { CopyButton } from './ui/copy-button.js'
import { useSignIn, type TeamState } from '../lib/team.js'

// Signing in with GitHub (Team mode, src/team/team-gate.ts): the page a browser not signed in gets
// on a shared machine (his pick 1A: a page of its own, nothing of the dashboard behind it), and
// the same steps where the owner turns Team mode on (Settings › Team). GitHub's device sign-in: a
// press asks for a code, copies it and opens GitHub's page, where it is pasted; this page goes on
// by itself once GitHub says yes.

/** The GitHub mark, as on GitHub's own sign-in buttons. */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  )
}

/** The page of a shared machine for a browser not signed in. */
export function TeamSignInPage({ team }: { team: Extract<TeamState, { on: true }> }) {
  const done = useCallback(() => location.reload(), [])
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <Logo className="size-9" />
        <SignInSteps
          turnOn={false}
          onDone={done}
          title={`Sign in to ${team.name}`}
          words="This OpenAgent is shared with a team. Sign in to see your sessions."
          owner={team.owner.name ?? team.owner.login}
        />
      </div>
    </main>
  )
}

/**
 * The steps: the press, GitHub's code while it waits, and how it ended when it did not sign in.
 * `turnOn`: asked to turn Team mode on, whoever signs in owns it.
 */
export function SignInSteps({
  turnOn,
  onDone,
  title,
  words,
  owner,
  onCancel,
  start: align = 'center',
}: {
  turnOn: boolean
  onDone: () => void
  title: string
  words: string
  owner?: string
  onCancel?: () => void
  /** `'start'`: lined up on the left, as in Settings; the page of its own centres them. */
  start?: 'center' | 'start'
}) {
  const titled = cn('font-semibold text-balance', align === 'center' ? 'text-xl' : 'text-base')
  const column = cn('flex w-full flex-col gap-4', align === 'center' ? 'items-center text-center' : 'items-start text-left')
  const { code, asking, end, start, cancel } = useSignIn(turnOn, onDone)
  // The press copies the code and opens GitHub's page in one: what is left there is a paste.
  const opened = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!code || opened.current === code.id) return
    opened.current = code.id
    void navigator.clipboard?.writeText(code.userCode).catch(() => undefined)
  }, [code])
  if (code)
    return (
      <div role="status" className={column}>
        <p className={titled}>Paste this code on GitHub</p>
        <div className="flex items-center gap-2">
          <code className="rounded-md bg-muted px-4 py-2 font-mono text-2xl font-medium tracking-widest">{code.userCode}</code>
          <CopyButton text={code.userCode} label="Copy the code" />
        </div>
        <a href={code.verificationUri} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
          Open {code.verificationUri.replace(/^https:\/\//, '')}
        </a>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Waiting for GitHub. This goes on by itself once you approve.
        </p>
        <Button variant="ghost" size="sm" onClick={() => (cancel(), onCancel?.())}>
          Cancel
        </Button>
      </div>
    )
  if (end?.kind === 'not-member')
    return (
      <div role="alert" className={column}>
        <p className={titled}>@{end.login} isn’t on this machine’s team</p>
        <p className="text-sm text-muted-foreground">
          Ask {owner ?? `@${end.owner}`} (@{end.owner}) to add <b className="font-medium text-foreground">{end.login}</b> in Settings › Team, then sign in again.
        </p>
        <Button className="w-full" size="lg" onClick={() => void start()}>
          <GitHubMark className="size-4" />
          Sign in again
        </Button>
        <p className="text-xs text-muted-foreground">To sign in as someone else, sign out of GitHub first.</p>
      </div>
    )
  return (
    <div className={column}>
      <p className={titled}>{title}</p>
      <p className="text-sm text-muted-foreground">{words}</p>
      <Button className="w-full" size="lg" loading={asking} onClick={() => void start()}>
        {asking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GitHubMark className="size-4" />}
        Sign in with GitHub
      </Button>
      {end?.kind === 'error' ? (
        <p role="alert" className="flex items-start gap-2 text-left text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {end.words}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">GitHub only tells OpenAgent who you are.</p>
      )}
    </div>
  )
}
