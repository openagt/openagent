import { useId, useState, type ReactNode } from 'react'
import { Button, CopyButton, RadioGroup, RadioGroupItem, SettingsRowShapes, SettingsSection, computerRpcClient, usePolled, useModuleHost, type ModuleHost } from '@openagt/ui/module'
import type { BridgeView } from '../src/server.js'

/** The module's server part, in no project: the bridge is this computer's. */
const server = (host: ModuleHost) => computerRpcClient<typeof import('../src/server.js')>(host)

/** How often the entry asks again where the bridge stands: a refused extension, a browser starting, clear on their own. */
const EVERY_MS = 3000

const ABOUT =
  'Start runs as Claude Code cloud sessions, see the question a session is parked on, and type your answer back: a browser signed in to claude.ai does the work, through the bridge extension.'

/**
 * Settings › Claude web (#1237, #1332): which browser does the extension's work, each choice with
 * what it needs under it: the browser OpenAgent runs, its state and its window; the person's own
 * Chrome, the extension's folder and the token to paste into it. One choice, as a person makes one,
 * though both could serve at once. And what the bridge last heard, when it refused it: a refused
 * extension looks merely missing otherwise.
 */
export function ClaudeWebSettings() {
  const host = useModuleHost()
  const { value: bridge, reload } = usePolled<BridgeView | null>(() => server(host).bridge({}).catch(() => null), null, EVERY_MS, [host])
  // The pick as made here, at once, before the next read says it.
  const [picked, setPicked] = useState<BridgeView['browser'] | undefined>()
  if (!bridge)
    return (
      <SettingsSection description={ABOUT}>
        <SettingsRowShapes rows={2} />
      </SettingsSection>
    )
  const browser = picked ?? bridge.browser
  const pick = (next: BridgeView['browser']) => {
    setPicked(next)
    void server(host)
      .pickBrowser({ browser: next })
      .catch(() => {})
      .finally(() => void reload())
  }
  return (
    <SettingsSection description={ABOUT}>
      <Refused bridge={bridge} />
      <BrowserChoice browser={browser} onPick={pick}>
        {{ app: <AppBrowser bridge={bridge} onChanged={() => void reload()} />, yours: <YourChrome folder={bridge.folder} /> }}
      </BrowserChoice>
    </SettingsSection>
  )
}

/**
 * The bridge's refusals, said: an extension of another version (#1519), whose calls are refused
 * until it is updated, and calls with a token the bridge does not know (#1225), which die before
 * the version is even read. Each would look like no extension at all.
 */
function Refused({ bridge }: { bridge: BridgeView }) {
  if (bridge.version?.blocked)
    return (
      <p role="alert" className="text-sm text-danger">
        The extension is blocked: it is v{bridge.version.got} and OpenAgent expects v{bridge.version.expected}. Update it, then reload it at chrome://extensions.
      </p>
    )
  if (bridge.lastContact?.status === 401)
    return (
      <p role="alert" className="text-sm text-danger">
        Something calls the bridge with a token OpenAgent does not know, so its calls get nowhere. Open the extension&apos;s options and save the token shown under Your own Chrome again.
      </p>
    )
  return null
}

/** Which browser does the work: one group of two radios, named by the question, the one picked showing what it needs. */
function BrowserChoice({ browser, onPick, children }: { browser: BridgeView['browser']; onPick: (next: BridgeView['browser']) => void; children: Record<BridgeView['browser'], ReactNode> }) {
  const question = useId()
  const option = (value: BridgeView['browser'], label: string, description: string) => (
    <label className="flex cursor-pointer gap-3">
      <RadioGroupItem value={value} aria-label={label} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
        {browser === value && children[value]}
      </span>
    </label>
  )
  return (
    <div>
      <p id={question} className="mb-3 text-sm font-medium">
        Which browser does the work?
      </p>
      <RadioGroup aria-labelledby={question} value={browser} onValueChange={next => onPick(next === 'app' ? 'app' : 'yours')} className="gap-4">
        {option('app', 'A browser OpenAgent runs', 'Chrome for Testing, downloaded once, signed in once, kept minimized. Web runs work with your own Chrome closed.')}
        {option('yours', 'Your own Chrome', 'Install the extension from the folder below, open its options and paste the token. Web runs need your Chrome open.')}
      </RadioGroup>
    </div>
  )
}

/**
 * The browser OpenAgent runs (#1332): where it stands, and the one thing only a person can do for
 * it, sign in to claude.ai, once, in its window. Kept minimized, nothing else shows it: its first
 * start downloads Chrome (minutes), and one the person quit stays quit until restarted here.
 */
function AppBrowser({ bridge, onChanged }: { bridge: BridgeView; onChanged: () => void }) {
  const host = useModuleHost()
  const status = bridge.browserState
  const act = (action: 'show' | 'hide' | 'restart') =>
    void server(host)
      .browserAction({ action })
      .catch(() => {})
      .finally(onChanged)
  return (
    <div className="mt-3 space-y-2 text-xs">
      {status.state === 'off' && <p className="text-muted-foreground">The browser is off.</p>}
      {status.state === 'starting' && <p className="text-muted-foreground">Starting the browser: {status.detail}.</p>}
      {status.state === 'stopped' && (
        <p className="text-danger">
          The browser is not running: {status.detail}.{' '}
          <Button variant="secondary" onClick={() => act('restart')}>
            Restart
          </Button>
        </p>
      )}
      {status.state === 'running' && (
        <>
          <p className="text-muted-foreground">
            The browser is running{status.visible ? ' with its window shown' : ', minimized'}.
            {status.signIn && ' It is on claude.ai’s sign-in page: show the window and sign in once, then hide it again.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {status.visible ? (
              <Button variant="secondary" onClick={() => act('hide')}>
                Hide the window
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => act('show')}>
                {status.signIn ? 'Show the window to sign in' : 'Show the window'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => act('restart')}>
              Restart
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The person's own Chrome (#1237): the folder the extension is loaded from, and the token it shows
 * on each call. The token is shown on request, not outright: a secret on screen for good is in every
 * screen recording, and OpenAgent is demoed.
 */
function YourChrome({ folder }: { folder: string | undefined }) {
  const host = useModuleHost()
  const [token, setToken] = useState<string | null | undefined>()
  const [shown, setShown] = useState(false)
  const reveal = () => {
    if (token !== undefined) return setShown(was => !was)
    void server(host)
      .token({})
      .then(
        read => {
          setToken(read)
          setShown(true)
        },
        () => setToken(null),
      )
  }
  return (
    <div className="mt-3 space-y-2 text-xs">
      {folder !== undefined && (
        <div className="space-y-1">
          <p className="text-muted-foreground">To install it: at chrome://extensions, turn on Developer mode, press Load unpacked and pick this folder.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2 py-1 font-mono">{folder}</code>
            <CopyButton text={folder} label="Copy the folder" />
          </div>
        </div>
      )}
      {token === null ? (
        <p className="text-danger">The token could not be read.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-sm bg-muted px-2 py-1.5 font-mono">{shown && token ? token : '•'.repeat(24)}</code>
          <Button variant="secondary" onClick={reveal}>
            {shown ? 'Hide' : 'Reveal'}
          </Button>
          {token && <CopyButton text={token} label="Copy the bridge token" />}
        </div>
      )}
    </div>
  )
}
