import { useEffect, useState } from 'react'
import type { BridgeBrowserStatus } from '../../src/bridge-browser.js'
import { onBridgeBrowser } from '../rpc/reads.js'
import { sendBridgeBrowser } from '../rpc/control.js'
import { Button } from './ui/button.js'

/**
 * The bridge browser's line in Settings › Claude web (#1332): where the daemon's own browser stands,
 * and the one thing only a person can do for it — sign in to claude.ai, once, in its window.
 *
 * The browser is minimized by design, so nothing about it is visible anywhere else: its first
 * launch downloads Chrome (minutes), its window is where the sign-in happens, and a browser the
 * user quit stays quit until asked for again. Each of those would read as "the bridge is broken"
 * without this line saying which it is.
 *
 * Whether a sign-in is needed comes with the status itself — the daemon reads which page its own
 * browser's tab is on — rather than from the bridge's last hello, which the user's own Chrome
 * may have written a second ago.
 */
export function BridgeBrowserSettings({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<BridgeBrowserStatus | null>(null)

  useEffect(() => {
    if (!enabled) {
      setStatus(null)
      return
    }
    let live = true
    const read = () =>
      void onBridgeBrowser()
        .then(next => {
          if (live) setStatus(next)
        })
        .catch(() => {})
    read()
    const timer = setInterval(read, 3000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [enabled])

  if (!enabled || !status) return null
  const act = (action: 'show' | 'hide' | 'restart') => void sendBridgeBrowser(action).catch(() => {})
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      {status.state === 'off' && <p className="text-muted-foreground">The bridge browser is off.</p>}
      {status.state === 'starting' && <p className="text-muted-foreground">Starting the bridge browser: {status.detail}.</p>}
      {status.state === 'stopped' && (
        <p className="text-danger">
          The bridge browser is not running: {status.detail}.{' '}
          <Button variant="outline" size="sm" onClick={() => act('restart')}>
            Restart
          </Button>
        </p>
      )}
      {status.state === 'running' && (
        <>
          <p className="text-muted-foreground">
            The bridge browser is running{status.visible ? ' with its window shown' : ', minimized'}.
            {status.signIn && ' It is on claude.ai’s sign-in page: show the window and sign in once, then hide it again.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {status.visible ? (
              <Button variant="outline" size="sm" onClick={() => act('hide')}>
                Hide the window
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => act('show')}>
                {status.signIn ? 'Show the window to sign in' : 'Show the window'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => act('restart')}>
              Restart
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
