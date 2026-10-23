import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { exec as realExec, lastLines, openSession, type Exec } from './ssh.js'
import { STEPS } from './steps.js'

/**
 * "Test connection": one real try at a server before anything is installed there, with this
 * computer's own SSH keys, as the install's first step logs in. What failed is said by what a
 * person does about it: the computer does not answer, SSH is not on there, this computer's key is
 * not on it, the user cannot become root without a password, the server shows another key than
 * the one remembered for it, or it is no system OpenAgent installs on.
 *
 * For the three a person fixes on the computer itself, a line to paste there once comes with it:
 * it turns SSH on, puts this computer's key on the user, and lets that user become root without
 * a password. It is root's line, so it asks for the computer's password once.
 */

export type Trouble = 'unreachable' | 'no-ssh' | 'key' | 'no-key' | 'sudo' | 'host-key' | 'system'

export type Tested =
  | { ok: true; /** What the server runs, as its first step says it: "Ubuntu 24.04 LTS, x86_64". */ system: string; fingerprint?: string }
  | {
      ok: false
      trouble: Trouble
      /** Something answered at the address. */
      reached: boolean
      /** What `ssh` or the server said. */
      said: string
      /** This computer's public key, for the troubles fixed on the computer itself. */
      key?: string
      /** The line to paste on the computer once, with that key. */
      fix?: string
    }

/** How a public key reads in a `.pub` file or from `ssh-add -L`: its kind, the key, and a word for whose it is. */
const PUBLIC_KEY = /^((?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521)|sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com) [A-Za-z0-9+/]+={0,3})(?: (.*))?$/

/** A public key as one word of a shell line: its kind and key, and its comment only when that is plain. */
export function plainKey(said: string): string | undefined {
  const match = PUBLIC_KEY.exec(said.trim())
  if (!match) return undefined
  const comment = match[2]?.trim()
  return comment && /^[A-Za-z0-9@._-]{1,64}$/.test(comment) ? `${match[1]} ${comment}` : match[1]
}

/** How long this computer's own `ssh` gets to say its settings or its agent's keys. */
const OWN_TIMEOUT_MS = 10_000

/**
 * This computer's public key that `ssh` offers the server: the first key file `ssh` would try
 * for it that has its `.pub` beside it, or else the first key the person's SSH agent holds.
 */
export async function ownKey(server: { address: string; user: string }, run: Exec = realExec, read: (path: string) => Promise<string> = path => readFile(path, 'utf8')): Promise<string | undefined> {
  const settings = await run('ssh', ['-G', '-l', server.user, '--', server.address], '', { timeoutMs: OWN_TIMEOUT_MS })
  const files = settings.code === 0 ? [...settings.out.matchAll(/^identityfile (.+)$/gm)].map(([, file]) => file!.trim().replace(/^~(?=\/)/, homedir())) : []
  for (const file of files) {
    const key = await read(`${file}.pub`).then(plainKey, () => undefined)
    if (key !== undefined) return key
  }
  const agent = await run('ssh-add', ['-L'], '', { timeoutMs: OWN_TIMEOUT_MS })
  return agent.code === 0 ? agent.out.split('\n').map(plainKey).find(key => key !== undefined) : undefined
}

/**
 * The line pasted once on the computer, as a person who may use `sudo` there: SSH on, `key` on
 * `user`, and `user` root without a password. Each part does nothing when it is done already, so
 * pasting it twice is pasting it once.
 */
export function fixLine(key: string, user: string): string {
  const parts = [
    'apt-get install -y openssh-server',
    `h=$(getent passwd ${user} | cut -d: -f6)`,
    `install -d -m 700 -o ${user} -g $(id -gn ${user}) "$h/.ssh"`,
    `k="${key}"`,
    `{ grep -qxF "$k" "$h/.ssh/authorized_keys" 2>/dev/null || echo "$k" >> "$h/.ssh/authorized_keys"; }`,
    `chown ${user} "$h/.ssh/authorized_keys"`,
    `chmod 600 "$h/.ssh/authorized_keys"`,
    // Root becomes root already.
    ...(user === 'root' ? [] : [`echo "${user} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/openagent-${user}`, `chmod 440 /etc/sudoers.d/openagent-${user}`]),
  ]
  return `sudo sh -c '${parts.join(' && ')}'`
}

/** What a failed login reads as, by what `ssh` said. */
function troubleOf(said: string): { trouble: Trouble; reached: boolean } {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/.test(said)) return { trouble: 'host-key', reached: true }
  if (/Connection refused/.test(said)) return { trouble: 'no-ssh', reached: true }
  if (/Permission denied|Too many authentication failures/.test(said)) return { trouble: 'key', reached: true }
  return { trouble: 'unreachable', reached: false }
}

/** The troubles a person fixes on the computer itself, with the line. */
const FIXED_THERE: readonly Trouble[] = ['no-ssh', 'key', 'sudo']

const SUDO = /sudo: a password is required|sudo: a terminal is required|sudo: command not found|sudo: not found|is not in the sudoers/

export async function testConnection(server: { address: string; user: string }, opts: { exec?: Exec; key?: () => Promise<string | undefined> } = {}): Promise<Tested> {
  const session = await openSession(server, opts.exec ? { exec: opts.exec } : {})
  let tested: Tested
  try {
    const met = await session.meet()
    if (!met.ok) tested = { ok: false, ...troubleOf(met.said), said: met.said || 'The server did not answer.' }
    else {
      // The install's own first step: as root, and it says what the server runs.
      const said = await session.run('root', STEPS[0]!.script({ address: server.address, version: '' }), 60_000)
      const words = lastLines(said)
      tested =
        said.code === 0
          ? { ok: true, system: said.out.trim().split('\n').at(-1) ?? '', ...(met.fingerprint ? { fingerprint: met.fingerprint } : {}) }
          : { ok: false, trouble: SUDO.test(words) ? 'sudo' : 'system', reached: true, said: words || 'The server did not answer.' }
    }
  } finally {
    await session.close()
  }
  if (tested.ok || !FIXED_THERE.includes(tested.trouble)) return tested
  const key = await (opts.key ?? (() => ownKey(server)))()
  // Nothing to put on the computer: this computer has no key to log in with, which comes first.
  // One that logged in has a key, if not one this computer can name: the words say what to do.
  if (key === undefined) return tested.trouble === 'sudo' ? tested : { ...tested, trouble: 'no-key' }
  return { ...tested, key, fix: fixLine(key, server.user) }
}
