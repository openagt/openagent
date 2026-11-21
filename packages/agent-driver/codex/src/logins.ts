import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { probeCli } from '@openagt/agent-driver'
import type { AgentAccount, AgentLogins, DriverRateWindow } from '@openagt/hooks'
import { accountFolder, codexAccountsDir, codexWho, loginCodex, readCodexUsage, type CodexLogin, type CodexLoginOptions, type CodexWho } from './codex-accounts.js'
import { personalCodexHome } from './codex-home.js'

// Codex's accounts (`RunAgent.accounts`, the list `codex`): the person's own login, in their own
// Codex home, and the ones added beside it, each in a folder of its own where Codex renews it
// (`codex-accounts.ts`). Taking one off the list takes its folder, its login in it, off this
// computer. Every login says how full it is now, read from its home.

/** The logins Codex takes from its environment before its own. */
const ENV_LOGINS = ['CODEX_API_KEY', 'OPENAI_API_KEY'] as const

/** How long Codex's logout gets: a page's call ends at 30 seconds. */
const LOG_OUT_MS = 25_000

/** What Codex's accounts reach for, swapped in tests: never the real `codex`, which would log this computer's person out. */
export interface CodexLoginsDeps {
  /** Log a new account in. Codex's own sign-in when unsaid. */
  login?: (opts: CodexLoginOptions) => Promise<CodexLogin>
  /** Who the login in a home is. */
  who?: (home: string) => Promise<CodexWho>
  /** How full the login in a home is, now. */
  usage?: (home: string) => Promise<DriverRateWindow[]>
}

/** Codex's accounts on this computer. */
export function codexLogins(deps: CodexLoginsDeps = {}): AgentLogins {
  const who = deps.who ?? codexWho
  const usage = deps.usage ?? (home => readCodexUsage({ home }))
  /** Where an account's login is: the person's own Codex home, or an added account's folder. */
  const homeOf = (account: AgentAccount, env: NodeJS.ProcessEnv): string => (account.login === undefined ? personalCodexHome(env) : accountFolder(account, env))
  return {
    list: 'codex',
    service: 'Codex',
    envLogins: ENV_LOGINS,
    installed: async () => (await probeCli('codex', ['--version'])).ok,
    ownLoginThere: env => ENV_LOGINS.some(name => env[name]) || existsSync(join(personalCodexHome(env), 'auth.json')),
    ownName: async env => (await who(personalCodexHome(env))).name,
    logOut: env => new Promise<void>((resolve, reject) => execFile('codex', ['logout'], { env, timeout: LOG_OUT_MS }, err => (err ? reject(err) : resolve()))),
    async signIn(accounts, said, env) {
      const dir = codexAccountsDir(env)
      const signed = await (deps.login ?? loginCodex)({ dir, ...(said.onCode ? { onCode: said.onCode } : {}), ...(said.onUrl ? { onUrl: said.onUrl } : {}), ...(said.signal ? { signal: said.signal } : {}) })
      if (!signed.ok) return signed
      // The browser may have been signed in to an account on the list already: that one is not added twice.
      const known = signed.who.key !== undefined ? await Promise.all(accounts.map(account => who(homeOf(account, env)).then(one => one.key))) : []
      if (signed.who.key !== undefined && known.includes(signed.who.key)) {
        await rm(join(dir, signed.login), { recursive: true, force: true })
        const elsewhere = said.onCode ? 'open the page in a private window, and sign in to the other account there' : 'copy the link into a private window and sign in to the other account there'
        return { ok: false, error: `That account is on the list already. If the browser was signed in to it, ${elsewhere}.` }
      }
      return { ok: true, login: signed.login }
    },
    // Codex's sign-in never has a code brought back: one is typed at its page.
    isSignInCode: () => false,
    async forget(account, env) {
      if (account.login !== undefined) await rm(accountFolder(account, env), { recursive: true, force: true })
    },
    async usage(account, env) {
      const home = homeOf(account, env)
      const known = await who(home)
      if (known.key === undefined && known.name === undefined) return undefined
      return usage(home).catch(() => undefined)
    },
  }
}
