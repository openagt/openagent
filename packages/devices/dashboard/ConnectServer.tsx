import { useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react'
import { Check, CircleCheck, CircleX, Cloud, House, Loader2, PlugZap } from 'lucide-react'
import { Button, Dialog, Input, RadioGroup, RadioGroupOption, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@openagt/dashboard/module'
import { login, testConnection, type Answer, type LoginRow, type ServerRow, type Tested } from './servers.js'
import { CopyButton } from './codes.js'
import { hasDoor } from './model.js'
import { Problem, StepLine, StepMark } from './parts.js'
import { WhoCanStart } from './ServerPage.js'
import type { Devices } from './use-devices.js'

// "Set up a server", in steps: where the server is, a test that this computer gets in there, the
// logins it gets, the install, and who else uses it. The install is the `devices server`
// command's own process: closing the dialog stops nothing, and the server's row shows how far it
// is. A computer at home, which nothing on the internet reaches, is set up the same way, through a
// server this computer is in at.

type Stage = 'where' | 'connect' | 'logins' | 'install' | 'ready'

const STAGES: readonly { id: Stage; title: string }[] = [
  { id: 'where', title: 'Where' },
  { id: 'connect', title: 'Connect' },
  { id: 'logins', title: 'Logins' },
  { id: 'install', title: 'Install' },
  { id: 'ready', title: 'Ready' },
]

type Kind = 'vps' | 'home'
type GithubPick = 'copy' | 'own' | 'later'

export function ConnectServer({ d, onClose, onInvite }: { d: Devices; onClose: () => void; /** Invite people to the server just set up: its page, inviting. */ onInvite: (address: string) => void }) {
  const doors = (d.machines?.machines ?? []).filter(hasDoor)
  const [stage, setStage] = useState<Stage>('where')
  const [kind, setKind] = useState<Kind>('vps')
  const [via, setVia] = useState<string | undefined>()
  const [address, setAddress] = useState('')
  const [user, setUser] = useState('root')
  // The last test, with the address and user it was made for: another address is not tested yet.
  const [tested, setTested] = useState<{ for: string; answer: Answer<Tested> } | undefined>()
  const [testing, setTesting] = useState(false)
  const [github, setGithub] = useState<GithubPick>(d.account !== undefined ? 'copy' : 'later')
  const [claude, setClaude] = useState<'login' | 'later'>('login')
  const [installed, setInstalled] = useState<string | undefined>()
  const through = kind === 'home' ? (via ?? doors[0]?.url) : undefined
  const at = address.trim()
  const as = user.trim()
  const current = tested?.for === `${at} ${as}` ? tested.answer : undefined

  const pickKind = (next: Kind): void => {
    setKind(next)
    // root on a server on the internet; on a PC at home, the person's own user there.
    if (next === 'home' && user === 'root') setUser('')
    if (next === 'vps' && user === '') setUser('root')
  }

  const test = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!at || !as) return
    setTesting(true)
    const answer = await testConnection(d.host, at, as)
    setTested({ for: `${at} ${as}`, answer })
    setTesting(false)
  }

  const install = async (): Promise<void> => {
    if (await d.install(at, as, github === 'copy' && d.account !== undefined, through)) {
      setInstalled(at)
      setStage('install')
    }
  }

  const server = installed !== undefined ? d.servers.find(row => row.address === installed) : undefined
  return (
    <Dialog open onOpenChange={open => !open && onClose()} title="Set up a server">
      <div className="max-h-[calc(100dvh-8rem)] space-y-4 overflow-y-auto">
        <Stepper at={stage} />
        {stage === 'where' && <Where kind={kind} onKind={pickKind} doors={doors.map(door => ({ value: door.url, label: door.label }))} through={through} onVia={setVia} onCancel={onClose} onNext={() => setStage('connect')} />}
        {stage === 'connect' && (
          <form onSubmit={event => void test(event)} className="space-y-3">
            <div className="grid grid-cols-[1fr_8rem] gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>{kind === 'home' ? 'Its address on its network' : 'Its address'}</span>
                <Input autoFocus aria-label="The server's address" placeholder={kind === 'home' ? '192.168.1.40' : '203.0.113.5'} value={address} onChange={event => setAddress(event.target.value)} />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>User</span>
                <Input aria-label="User name" placeholder={kind === 'home' ? 'yours on it' : 'root'} value={user} onChange={event => setUser(event.target.value)} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {kind === 'home'
                ? 'Your own user on the PC, which becomes root without a password: only to install, to update and to give it logins. What runs there afterwards runs as a user of its own, openagent.'
                : 'root, or a user that becomes root without a password: only to install, to update and to give the server logins. What runs there afterwards runs as a user of its own, openagent.'}
            </p>
            <Button size="sm" type="submit" variant="outline" disabled={testing || !at || !as}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <PlugZap className="h-3.5 w-3.5" aria-hidden />}
              Test connection
            </Button>
            {current !== undefined && !testing && <TestResult answer={current} address={at} user={as} home={kind === 'home'} />}
            <Footer>
              <Button size="sm" type="button" variant="ghost" onClick={() => setStage('where')}>
                Back
              </Button>
              <Button size="sm" type="button" disabled={!current?.ok || !current.value.ok} onClick={() => setStage('logins')}>
                Continue
              </Button>
            </Footer>
          </form>
        )}
        {stage === 'logins' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">GitHub</p>
              <RadioGroup aria-label="GitHub on the server" value={github} disabled={d.busy} onValueChange={next => setGithub(next as GithubPick)}>
                <RadioGroupOption value="copy" disabled={d.account === undefined}>
                  {d.account !== undefined ? `Copy mine (${d.account})` : 'Copy mine'}
                  {d.account === undefined && d.noLogin !== undefined && <span className="block w-full pl-6 text-xs text-muted-foreground">{d.noLogin}</span>}
                </RadioGroupOption>
                <RadioGroupOption value="own">
                  Log in to another account on the server
                  <span className="block w-full pl-6 text-xs text-muted-foreground">Once it is installed, GitHub gives a short code: you type it at github.com/login/device.</span>
                </RadioGroupOption>
                <RadioGroupOption value="later">Later</RadioGroupOption>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Claude</p>
              <RadioGroup aria-label="Claude on the server" value={claude} disabled={d.busy} onValueChange={next => setClaude(next as 'login' | 'later')}>
                <RadioGroupOption value="login">
                  Log in once it is installed
                  <span className="block w-full pl-6 text-xs text-muted-foreground">Your browser opens then: say yes there. The login is made for this server alone, lasts a year, and leaves this computer's login as it is.</span>
                </RadioGroupOption>
                <RadioGroupOption value="later">Later</RadioGroupOption>
              </RadioGroup>
            </div>
            {d.error !== undefined && <Problem>{d.error}</Problem>}
            <Footer>
              <Button size="sm" variant="ghost" onClick={() => setStage('connect')}>
                Back
              </Button>
              {/* Not before this computer has said which OpenAgent it runs: that is the one the server gets. */}
              <Button size="sm" disabled={d.busy || !d.machines} onClick={() => void install()}>
                {d.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                Install
              </Button>
            </Footer>
          </div>
        )}
        {stage === 'install' && <Installing d={d} server={server} github={github} claude={claude === 'login'} onReady={() => setStage('ready')} onClose={onClose} />}
        {stage === 'ready' && server !== undefined && <Ready d={d} server={server} onInvite={() => onInvite(server.address)} onClose={onClose} />}
      </div>
    </Dialog>
  )
}

/** The steps along the top: each one done ticked, the one at hand named; on a phone only that one's name. */
function Stepper({ at }: { at: Stage }) {
  const index = STAGES.findIndex(stage => stage.id === at)
  return (
    <ol aria-label="Steps" className="flex items-center gap-2 text-xs">
      {STAGES.map((stage, i) => (
        <li key={stage.id} aria-current={i === index ? 'step' : undefined} aria-label={`${stage.title}: ${i < index ? 'done' : i === index ? 'now' : 'next'}`} className={cn('flex items-center gap-2', i > 0 && 'flex-1')}>
          {i > 0 && <span aria-hidden className="h-px min-w-3 flex-1 bg-border" />}
          <span className={cn('flex shrink-0 items-center gap-1.5', i === index ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            <span aria-hidden className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[11px]', i <= index ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'bg-muted')}>
              {i < index ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={cn(i !== index && 'max-sm:hidden')}>{stage.title}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 pt-1">{children}</div>
}

/** One of the two places a server is, as a card to pick. */
function Choice({ picked, disabled, icon: Icon, title, words, onPick, children }: { picked: boolean; disabled?: boolean; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; title: string; words: string; onPick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={picked}
      disabled={disabled}
      onClick={onPick}
      className={cn('flex w-full gap-3 rounded-lg border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-60', picked ? 'border-[var(--color-primary)]' : 'border-border')}
    >
      <span aria-hidden className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border', picked ? 'border-[5px] border-[var(--color-primary)]' : 'border-muted-foreground/50')} />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">{words}</span>
        {children}
      </span>
    </button>
  )
}

function Where({ kind, onKind, doors, through, onVia, onCancel, onNext }: { kind: Kind; onKind: (kind: Kind) => void; doors: { value: string; label: string }[]; through: string | undefined; onVia: (url: string) => void; onCancel: () => void; onNext: () => void }) {
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Where the server is" className="space-y-2">
        <Choice picked={kind === 'vps'} icon={Cloud} title="A cloud server (VPS)" words="DigitalOcean, Hetzner and the like, with Ubuntu or Debian. Reached from anywhere, with a lock." onPick={() => onKind('vps')} />
        <Choice
          picked={kind === 'home'}
          disabled={doors.length === 0}
          icon={House}
          title="A PC at home or in an office"
          words="Ubuntu or Debian, on all the time. Nothing on the internet reaches it, so it is reached through one of your cloud servers."
          onPick={() => onKind('home')}
        >
          {doors.length === 0 && <span className="mt-1 block text-xs text-foreground">Set up a cloud server first.</span>}
        </Choice>
      </div>
      {kind === 'home' && through !== undefined && (
        <div className="flex items-center gap-2 pl-9 text-xs text-muted-foreground">
          Reached through
          <Select items={doors} value={through} onValueChange={next => onVia(next as string)}>
            <SelectTrigger size="sm" aria-label="The server it is reached through" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {doors.map(door => (
                <SelectItem key={door.value} value={door.value}>
                  {door.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <Footer>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onNext}>
          Continue
        </Button>
      </Footer>
    </div>
  )
}

function Line({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={cn('flex items-start gap-2', ok ? 'text-success' : 'text-danger')}>
      {ok ? <CircleCheck aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" /> : <CircleX aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />}
      <span>{children}</span>
    </li>
  )
}

/** A line to paste somewhere, with its Copy button and what it does. */
function Paste({ lead, text, label, after }: { lead: string; text: string; label: string; after: string }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted p-3 text-xs">
      <p>{lead}</p>
      <div className="flex items-center gap-2">
        <code title={text} className="min-w-0 flex-1 truncate rounded border border-border bg-background px-2 py-1 font-mono">
          {text}
        </code>
        <CopyButton text={text} label={label}>
          Copy
        </CopyButton>
      </div>
      <p className="text-muted-foreground">{after}</p>
    </div>
  )
}

/** What a test found: each thing that went through, the one that did not, and what to do about it. */
function TestResult({ answer, address, user, home }: { answer: Answer<Tested>; address: string; user: string; home: boolean }) {
  if (!answer.ok) return <Problem>{answer.error}</Problem>
  const tested = answer.value
  const pc = home ? 'the PC' : 'the server'
  const reached = <Line ok>{`Reached ${address}`}</Line>
  const loggedIn = <Line ok>{`Logged in as ${user}`}</Line>
  if (tested.ok)
    return (
      <ul aria-label="What the test found" className="space-y-1 text-xs">
        {reached}
        {loggedIn}
        <Line ok>{tested.system ? `${tested.system}: OpenAgent installs there` : 'OpenAgent installs there'}</Line>
      </ul>
    )
  const { trouble } = tested
  return (
    <div className="space-y-3">
      <ul aria-label="What the test found" className="space-y-1 text-xs">
        {tested.reached && reached}
        {(trouble === 'sudo' || trouble === 'system') && loggedIn}
        <Line ok={false}>
          {trouble === 'unreachable'
            ? `Nothing answers at ${address}. Check the address, and that ${pc} is on${home ? ' and on this network' : ''}.`
            : trouble === 'no-ssh'
              ? 'SSH is not on there yet.'
              : trouble === 'key'
                ? 'Your SSH key is not on it yet.'
                : trouble === 'no-key'
                  ? 'This computer has no SSH key yet.'
                  : trouble === 'sudo'
                    ? `${user} cannot become root without a password.`
                    : trouble === 'host-key'
                      ? `It shows another key than the one this computer remembers for ${address}. Nothing was sent to it.`
                      : tested.said}
        </Line>
      </ul>
      {tested.fix !== undefined && (
        <Paste
          lead={home ? 'On the PC, open a terminal and paste this once. It lets this computer in, and nobody else:' : "Open the server's own console at your provider, and paste this once. It lets this computer in, and nobody else:"}
          text={tested.fix}
          label={`Copy the line for ${pc}`}
          after={`It asks for ${home ? "the PC's" : "the server's"} password once: it turns SSH on, adds this computer's key${user === 'root' ? '' : `, and lets ${user} install without a password`}. Then press Test connection again.`}
        />
      )}
      {trouble === 'no-key' && <Paste lead="Make one: open a terminal on this computer and paste this once." text={'ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519'} label="Copy the line that makes a key" after="Then press Test connection again." />}
      {trouble === 'host-key' && (
        <Paste lead={`If ${pc} was set up again since, forget its old key: open a terminal on this computer and paste this.`} text={`ssh-keygen -R ${address}`} label="Copy the line that forgets the old key" after="Then press Test connection again: the key it shows then is taken and remembered." />
      )}
    </div>
  )
}

/** A login the person picked, made once the install is done, as a line among its steps. */
function LoginStep({ label, login, words }: { label: string; login: LoginRow; words?: ReactNode }) {
  const state = login.working ? 'running' : login.there ? 'done' : login.said !== undefined ? 'failed' : 'waiting'
  return (
    <StepLine label={label} state={state} said={state === 'failed' ? login.said : undefined}>
      {words !== undefined && state === 'running' && <span className="ml-5.5 block text-xs text-muted-foreground">{words}</span>}
    </StepLine>
  )
}

/** Settled: made, or failed and said why. */
const settled = (login: LoginRow): boolean => !login.working && (login.there || login.said !== undefined)
const failedLogin = (login: LoginRow): boolean => !login.working && !login.there && login.said !== undefined

function Installing({ d, server, github, claude, onReady, onClose }: { d: Devices; server: ServerRow | undefined; github: GithubPick; claude: boolean; onReady: () => void; onClose: () => void }) {
  const asked = useRef(false)
  const done = server !== undefined && !server.working && server.steps.every(step => step.state === 'done')
  const failed = server !== undefined && !server.working && server.steps.some(step => step.state === 'failed')
  const item = d.items.find(candidate => candidate.kind === 'server' && candidate.server.address === server?.address)
  const saved = item?.kind === 'server' && item.machine !== undefined && server?.adding === false
  const reason = server !== undefined ? d.notAdded[server.address] : undefined
  const logins = server?.logins
  // The logins the person picked here, each made or failed.
  const loginsSettled = logins !== undefined && (github === 'later' || settled(logins.github)) && (!claude || settled(logins.claude))
  const loginFailed = logins !== undefined && ((github !== 'later' && failedLogin(logins.github)) || (claude && failedLogin(logins.claude)))

  // Once it is installed, the logins that need the person here start: a code for GitHub, this computer's browser for Claude.
  useEffect(() => {
    if (!done || server === undefined || asked.current) return
    asked.current = true
    void (async () => {
      if (github === 'own') await d.act(() => login(d.host, server.address, 'github', true))
      if (claude) await d.act(() => login(d.host, server.address, 'claude'))
    })()
  })
  useEffect(() => {
    if (done && saved && loginsSettled && !loginFailed) onReady()
  })

  if (server === undefined) return <Loader2 aria-label="Starting" className="h-4 w-4 animate-spin text-primary" />
  const sendable = saved ? 'done' : reason !== undefined ? 'failed' : done ? 'running' : 'waiting'
  const code = server.logins.github.code
  return (
    <div className="space-y-3">
      <ol aria-label={`The install on ${server.address}`} className="space-y-1.5 text-sm">
        {server.steps.map(step => (
          <StepLine key={step.id} label={step.label} state={step.state} said={step.state === 'failed' ? step.said : undefined} />
        ))}
        {github !== 'later' && (
          <LoginStep
            label={github === 'copy' ? 'Your GitHub login' : 'A GitHub login of its own'}
            login={server.logins.github}
            words={
              code !== undefined ? (
                <>
                  {`Type the code ${code} at `}
                  <a href="https://github.com/login/device" target="_blank" rel="noreferrer" className="underline">
                    github.com/login/device
                  </a>
                  , and say yes there.
                </>
              ) : undefined
            }
          />
        )}
        {claude && <LoginStep label="Claude login" login={server.logins.claude} words={server.logins.claude.asking ? "Say yes in the page this computer's browser opened." : undefined} />}
        <li aria-label={`Runs can be sent to it: ${sendable}`}>
          <span className={cn('flex items-center gap-2', sendable === 'failed' ? 'text-danger' : sendable === 'waiting' ? 'text-muted-foreground' : undefined)}>
            <StepMark state={sendable} />
            Runs can be sent to it
          </span>
          {reason !== undefined && <p className="mt-1 ml-5.5 text-xs text-danger">{reason}</p>}
        </li>
      </ol>
      {!failed && !done && <p className="text-xs text-muted-foreground">A few minutes. You can close this: it goes on, and its row shows how far it is.</p>}
      {d.error !== undefined && <Problem>{d.error}</Problem>}
      <Footer>
        {failed && (
          <Button size="sm" disabled={d.busy} onClick={() => void d.install(server.address, server.user, server.logins.github.wanted === true)}>
            Try again
          </Button>
        )}
        {reason !== undefined && (
          <Button size="sm" disabled={d.busy} onClick={() => void d.addToMachines(server)}>
            Try again
          </Button>
        )}
        {done && saved && loginFailed && (
          <Button size="sm" onClick={onReady}>
            Continue
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </Footer>
    </div>
  )
}

function Ready({ d, server, onInvite, onClose }: { d: Devices; server: ServerRow; onInvite: () => void; onClose: () => void }) {
  const item = d.items.find(candidate => candidate.kind === 'server' && candidate.server.address === server.address)
  const name = item?.name ?? server.address
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-1 py-1 text-center">
        <CircleCheck aria-hidden className="h-5 w-5 text-success" />
        <p className="text-sm font-medium">{`${name} is ready.`}</p>
        <p className="text-xs text-muted-foreground">
          {server.through !== undefined ? 'Your runs can go there from here. Who else uses it?' : 'Your runs can go there from here. Anyone else? Invite them: each works there with their own logins.'}
        </p>
      </div>
      {server.through !== undefined && <WhoCanStart host={d.host} server={{ ...server, through: server.through }} busy={d.busy} onChange={d.act} />}
      <Footer>
        {server.through === undefined && (
          <Button size="sm" variant="outline" onClick={onInvite}>
            Invite people
          </Button>
        )}
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </Footer>
    </div>
  )
}
