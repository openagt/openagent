import { useEffect, useState } from 'react'
import { onBridgeStatus, onBridgeToken } from '../rpc/reads.js'
import { Button } from './ui/button.js'
import { CopyButton } from './ui/copy-button.js'

/**
 * Setting up the browser bridge (#1237).
 *
 * This exists because the feature was unusable without it: turning the bridge on meant editing
 * `~/.openagent.json` by hand, and getting the token meant copying a field out of the same
 * file. Neither is something to ask of anyone, and a token nobody can find is a feature nobody
 * can enable.
 *
 * The token is revealed on request rather than rendered outright. Not because showing it is
 * dangerous here (anyone who can load this page can already start runs on this machine) but
 * because a secret sitting permanently on screen is a secret in every screen recording and
 * screenshot, and this dashboard is demoed.
 */
export function BridgeSettings({ enabled, onChange }: { enabled: boolean; onChange: (next: boolean) => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const [blocked, setBlocked] = useState<{ got: string; expected: string } | null>(null)
  const [refused, setRefused] = useState(false)

  // The version gate's visible half (#1519): a refused extension would otherwise look merely
  // disconnected, and "the bridge stopped working" after a pull is exactly this. Polled, because
  // the block clears on the extension's own next call, not on anything this page does.
  // A rejected token gets the same treatment (#1225): it dies before the version gate, so an
  // extension that is stale in both copy and token never even records a version claim — the
  // store's refused-contact slot is the only trace, and without this line that failure is
  // silent everywhere.
  useEffect(() => {
    if (!enabled) {
      setBlocked(null)
      setRefused(false)
      return
    }
    let live = true
    const read = () =>
      void onBridgeStatus()
        .then(status => {
          if (!live) return
          setBlocked(status.version?.blocked ? { got: status.version.got, expected: status.version.expected } : null)
          setRefused(status.lastContact?.status === 401)
        })
        .catch(() => {})
    read()
    const timer = setInterval(read, 5000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setToken(null)
      setShown(false)
      return
    }
    let live = true
    void onBridgeToken()
      .then(next => {
        if (live) setToken(next)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      <p className="text-muted-foreground">
        Install the browser extension, open its options, and paste this token. It reports the question a Claude web
        session is parked on, so it shows up here instead of only on claude.ai.
      </p>
      {blocked && (
        <p className="text-danger">
          The extension is blocked: it is v{blocked.got} and this dashboard expects v{blocked.expected}. Update it —
          pull the repo, then reload the extension at chrome://extensions.
        </p>
      )}
      {!blocked && refused && (
        <p className="text-danger">
          Something is calling the bridge with a token this dashboard rejects, so the calls get nowhere. Open the
          extension&apos;s options and save the token shown below again.
        </p>
      )}
      {token === null ? (
        // A restart is genuinely required: the token is read when the daemon starts.
        <p className="text-muted-foreground">Restart the dashboard to generate the token.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono">
            {shown ? token : '•'.repeat(24)}
          </code>
          <Button variant="outline" size="sm" onClick={() => setShown(v => !v)}>
            {shown ? 'Hide' : 'Reveal'}
          </Button>
          <CopyButton text={token} label="Copy the bridge token" />
        </div>
      )}
    </div>
  )
}
