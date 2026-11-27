import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, isAbsolute } from 'node:path'
import { errorMessage } from '@openagt/git-branches'
import type { GhRunner } from './gh.js'
import { jobFiles, jobState, lastLines, startJob, stopJob, type JobFiles } from './job.js'

/**
 * The GitHub accounts OpenAgent has, and the one its runs use. They are OpenAgent's own, never the
 * person's: each account is a folder of its own, the folder `gh` keeps that account's login in
 * (`GH_CONFIG_DIR`), so nothing OpenAgent does reads or changes the person's own `gh`, git or
 * keychain. An account is added by logging it in here, in the browser.
 *
 * The runs' pick is kept in a file of its own, logins only.
 */

/** The host this package answers for. */
export const HOST = 'github.com'

/** An account OpenAgent has on the host. */
export interface GhAccount {
  login: string
  /** Whether GitHub still takes its login: false for one that was revoked or expired. */
  ok: boolean
}

/** Whether `gh` is on this computer at all, and OpenAgent's accounts. */
export type GhState = { installed: false } | { installed: true; accounts: GhAccount[] }

/** What OpenAgent keeps of an account beside its login: what its commits are signed with. */
export interface AccountFacts {
  login: string
  id: number
  name?: string
}

/** A GitHub login, as GitHub allows one: also what keeps a folder's name inside the accounts' folder. */
export function isGithubLogin(login: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)
}

/** Where OpenAgent's accounts are: one folder each, beside OpenAgent's other files in the person's config folder. */
export function accountsRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env['XDG_CONFIG_HOME']) return join(env['XDG_CONFIG_HOME'], 'openagent-github')
  return join(env['HOME'] ?? homedir(), '.openagent-github')
}

/** The folder of one account: what `gh` is given as `GH_CONFIG_DIR` to work as it. */
export function accountDir(root: string, login: string): string {
  if (!isGithubLogin(login)) throw new Error(`${login} is no GitHub login`)
  return join(root, login)
}

/** Where a browser login waits until GitHub said yes; then it becomes the account's folder. */
const ADDING = '.adding'

/** Whether `dir` is one of OpenAgent's account folders: a run is given one, and works as it. */
export function isAccountDir(root: string, dir: string): boolean {
  const rel = relative(root, dir)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && isGithubLogin(rel)
}

/** `gh` working as the account in `dir`: its folder, never the person's, and no token from the environment unless given. */
export function asAccount(gh: GhRunner, dir: string): GhRunner {
  return (args, cwd, env, input) => gh(args, cwd, { GH_TOKEN: '', GITHUB_TOKEN: '', ...env, GH_CONFIG_DIR: dir }, input)
}

/** The logins OpenAgent has, by name. */
export function accountLogins(root: string): string[] {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  return names.filter(name => isGithubLogin(name) && existsSync(join(root, name, 'hosts.yml'))).sort((a, b) => a.localeCompare(b))
}

export function readFacts(dir: string): AccountFacts | undefined {
  try {
    const facts = JSON.parse(readFileSync(join(dir, 'account.json'), 'utf8')) as Partial<AccountFacts>
    if (typeof facts.login === 'string' && typeof facts.id === 'number') return { login: facts.login, id: facts.id, ...(typeof facts.name === 'string' && facts.name ? { name: facts.name } : {}) }
  } catch {
    // None kept: the account was added before its facts were.
  }
  return undefined
}

function writeFile600(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const next = `${path}.${process.pid}.tmp`
  writeFileSync(next, text, { mode: 0o600 })
  chmodSync(next, 0o600)
  renameSync(next, path)
}

/** Who GitHub says the account `gh` works as is: its login, id and name. */
export async function whoAmI(gh: GhRunner, cwd: string): Promise<AccountFacts> {
  const said = (await gh(['api', '--hostname', HOST, 'user', '--jq', '[.login, (.id | tostring), (.name // "")] | @tsv'], cwd)).trim()
  const [login = '', id = '', name = ''] = said.split('\t')
  if (!isGithubLogin(login) || !/^\d+$/.test(id)) throw new Error(`GitHub said no account: ${said || 'nothing'}`)
  return { login, id: Number(id), ...(name ? { name } : {}) }
}

/**
 * A browser login that GitHub said yes to becomes an account: its folder is named by its login,
 * an account of that name before it replaced. Nothing while the login is still waiting, or when
 * none was started. Answers the login added.
 */
export async function settleAdded(root: string, gh: GhRunner, cwd: string, files: JobFiles = jobFiles('login'), picks: string = picksPath()): Promise<string | undefined> {
  const adding = join(root, ADDING)
  if (!existsSync(join(adding, 'hosts.yml'))) return undefined
  const state = jobState(files)
  if (state?.running) return undefined
  if (state && 'failed' in state && state.failed !== undefined) {
    rmSync(adding, { recursive: true, force: true })
    return undefined
  }
  const facts = await whoAmI(asAccount(gh, adding), cwd)
  const dir = accountDir(root, facts.login)
  rmSync(dir, { recursive: true, force: true })
  renameSync(adding, dir)
  writeFile600(join(dir, 'account.json'), `${JSON.stringify(facts, null, 2)}\n`)
  // On a machine shared by a team, the account is the one's who started its login.
  const team = readPicks(picks).team
  if (team?.adding !== undefined) changeTeamPicks(({ adding, ...rest }) => ({ ...rest, owners: { ...rest.owners, [facts.login]: adding! } }), picks)
  return facts.login
}

/** Where the runs' pick is kept: beside OpenAgent's other files in the person's config folder. */
export function picksPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env['XDG_CONFIG_HOME']) return join(env['XDG_CONFIG_HOME'], 'openagent-github.json')
  return join(env['HOME'] ?? homedir(), '.openagent-github.json')
}

interface PicksFile {
  /** The account runs use, by host. */
  runs: Record<string, string>
  /** On a machine shared by a team: whose each account is, which are shared, and each person's own pick for runs. */
  team?: TeamPicks
}

/**
 * The team's word on the accounts (Team mode): who added each one, by GitHub username (one with
 * none is from before, the team owner's), the ones their owners share, each person's pick for
 * their runs, and who the login under way is for.
 */
export interface TeamPicks {
  owners: Record<string, string>
  shared: string[]
  runsFor: Record<string, string>
  adding?: string
}

const strings = (value: unknown): Record<string, string> =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}

function readPicks(path: string): PicksFile {
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as Partial<PicksFile> & { team?: Partial<TeamPicks> }
    const team = file.team && typeof file.team === 'object' ? file.team : undefined
    return {
      runs: strings(file.runs),
      ...(team
        ? {
            team: {
              owners: strings(team.owners),
              shared: Array.isArray(team.shared) ? team.shared.filter((login): login is string => typeof login === 'string') : [],
              runsFor: strings(team.runsFor),
              ...(typeof team.adding === 'string' ? { adding: team.adding } : {}),
            },
          }
        : {}),
    }
  } catch {
    // No file yet, or one that does not read: no pick.
  }
  return { runs: {} }
}

/** The team's word on the accounts: none said yet is an empty one. */
export function readTeamPicks(path: string = picksPath()): TeamPicks {
  return readPicks(path).team ?? { owners: {}, shared: [], runsFor: {} }
}

/** Change the team's word on the accounts, the rest of the file as it is. */
export function changeTeamPicks(change: (team: TeamPicks) => TeamPicks, path: string = picksPath()): TeamPicks {
  const picks = readPicks(path)
  const team = change(picks.team ?? { owners: {}, shared: [], runsFor: {} })
  writePicks(path, { ...picks, team })
  return team
}

function writePicks(path: string, file: PicksFile): void {
  writeFile600(path, `${JSON.stringify(file, null, 2)}\n`)
}

/**
 * Whether `gh` is on this computer, and OpenAgent's accounts with whether GitHub still takes each.
 * A `gh` that is not on this computer is "not installed".
 */
export async function ghState(root: string, cwd: string, gh: GhRunner): Promise<GhState> {
  try {
    await gh(['--version'], cwd)
  } catch (err) {
    if (/ENOENT|not found/i.test(errorMessage(err))) return { installed: false }
  }
  const accounts: GhAccount[] = []
  for (const login of accountLogins(root)) {
    const ok = await asAccount(gh, join(root, login))(['auth', 'status', '--hostname', HOST], cwd).then(
      () => true,
      () => false,
    )
    accounts.push({ login, ok })
  }
  return { installed: true, accounts }
}

/**
 * OpenAgent's accounts by their folders, asking GitHub nothing: none while `gh` is not on this
 * computer. What a command that works as one of them picks it from; whether its token still works
 * is said by the command's own call ({@link ghState} asks GitHub for each, a call per account).
 */
export async function listedAccounts(root: string, cwd: string, gh: GhRunner): Promise<GhAccount[]> {
  try {
    await gh(['--version'], cwd)
  } catch (err) {
    if (/ENOENT|not found/i.test(errorMessage(err))) return []
  }
  return accountLogins(root).map(login => ({ login, ok: true }))
}

/** How long GitHub's word on whose a token is holds: the same token stays the same account's. */
export const VERIFIED_MS = 24 * 60 * 60_000

/** The hash a token is known by in its account's folder: the token itself is never written there. */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Whether GitHub said, less than {@link VERIFIED_MS} ago, that `token` is `login`'s. */
export function verifiedToken(dir: string, token: string, login: string, now: number = Date.now()): boolean {
  try {
    const kept = JSON.parse(readFileSync(join(dir, 'verified.json'), 'utf8')) as { hash?: unknown; login?: unknown; at?: unknown }
    return kept.hash === tokenHash(token) && typeof kept.login === 'string' && kept.login.toLowerCase() === login.toLowerCase() && typeof kept.at === 'number' && now - kept.at < VERIFIED_MS && kept.at <= now
  } catch {
    return false
  }
}

/** GitHub said `token` is `login`'s: kept, by the token's hash, so the next command need not ask again. */
export function keepVerified(dir: string, token: string, login: string, now: number = Date.now()): void {
  try {
    writeFile600(join(dir, 'verified.json'), `${JSON.stringify({ hash: tokenHash(token), login, at: now })}\n`)
  } catch {
    // Not kept: the next command asks GitHub again.
  }
}

/** OpenAgent's accounts, as {@link ghState} reads them: none while `gh` is not on this computer. */
export async function installedAccounts(root: string, cwd: string, gh: GhRunner): Promise<GhAccount[]> {
  const state = await ghState(root, cwd, gh)
  return state.installed ? state.accounts : []
}

/** The account runs use: the one picked, while OpenAgent still has it; else the first, kept as the pick from now on. */
export function runsAccount(accounts: readonly GhAccount[], path: string = picksPath()): string | undefined {
  const picks = readPicks(path)
  const picked = picks.runs[HOST]
  if (picked !== undefined && accounts.some(a => a.login === picked)) return picked
  const first = accounts[0]?.login
  if (first !== undefined) writePicks(path, { ...picks, runs: { ...picks.runs, [HOST]: first } })
  return first
}

/**
 * The account runs use and its folder, read off the files alone, asking GitHub nothing: for
 * OpenAgent's own copy of its login to a server. None when OpenAgent has no account.
 */
export function runsAccountDir(env: NodeJS.ProcessEnv = process.env): { login: string; dir: string } | undefined {
  const root = accountsRoot(env)
  const login = runsAccount(accountLogins(root).map(name => ({ login: name, ok: true })), picksPath(env))
  return login === undefined ? undefined : { login, dir: accountDir(root, login) }
}

/** Runs use `login` from now on: an account OpenAgent has. */
export function useForRuns(login: string, accounts: readonly GhAccount[], path: string = picksPath()): void {
  if (!accounts.some(a => a.login === login)) throw new Error(`OpenAgent has no GitHub account ${login}: add it in Permissions first`)
  const picks = readPicks(path)
  writePicks(path, { ...picks, runs: { ...picks.runs, [HOST]: login } })
}

/** A login in the browser, under way: the code the person types, and where. */
export interface LoggingIn {
  code: string
  url: string
}

// gh 2.93 says `one-time code: ABCD-1234`, 2.103 `One-time code (ABCD-1234) copied to clipboard`.
const CODE = /one-time code:?\s*\(?([A-Z0-9]{4}-[A-Z0-9]{4})/i
const DEVICE_URL = /(https:\/\/github\.com\/login\/device)/

function codeIn(said: string): LoggingIn | undefined {
  const code = CODE.exec(said)?.[1]
  return code ? { code, url: DEVICE_URL.exec(said)?.[1] ?? 'https://github.com/login/device' } : undefined
}

/** The login under way, while its `gh` is still waiting for the browser's yes. */
export function loginUnderWay(files = jobFiles('login')): LoggingIn | undefined {
  const state = jobState(files)
  return state?.running ? codeIn(state.said) : undefined
}

/**
 * Log an account in, in the browser: GitHub's device login, whose code the person types at
 * github.com/login/device, wherever they are. The login goes into a folder of its own, its token
 * kept there and not in the keychain the person's `gh` uses, so the person's own logins stay as
 * they are. Answers once `gh` showed the code; `gh` waits on, in a process of its own, for the
 * yes; {@link settleAdded} then names the folder by the account.
 */
export async function startLogin(root: string, files = jobFiles('login'), waitMs = 20_000): Promise<LoggingIn> {
  const under = loginUnderWay(files)
  if (under) return under
  const adding = join(root, ADDING)
  rmSync(adding, { recursive: true, force: true })
  mkdirSync(adding, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  await startJob(files, `env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR="$1" gh auth login --hostname ${HOST} --web --insecure-storage --skip-ssh-key`, [adding])
  const until = Date.now() + waitMs
  for (;;) {
    const state = jobState(files)
    const shown = state ? codeIn(state.said) : undefined
    if (shown) return shown
    if (!state?.running || Date.now() > until) {
      if (state?.running) stopJob(files)
      const said = (state && !state.running ? state.failed : undefined) ?? (lastLines(state?.said ?? '') || 'gh showed no code to log in with')
      // A refusal is told by its last line: gh's lines go as one.
      throw new Error(said.replaceAll('\n', '; '))
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

/** OpenAgent forgets an account: its folder goes, and a runs' pick that named it. The token is not ended. */
export function forgetAccount(root: string, login: string, path: string = picksPath()): void {
  rmSync(accountDir(root, login), { recursive: true, force: true })
  const picks = readPicks(path)
  const runs = picks.runs[HOST] === login ? Object.fromEntries(Object.entries(picks.runs).filter(([host]) => host !== HOST)) : picks.runs
  // On a machine shared by a team, nothing of it is kept: whose it was, its sharing, the picks that named it.
  const team = picks.team && {
    ...picks.team,
    owners: Object.fromEntries(Object.entries(picks.team.owners).filter(([one]) => one !== login)),
    shared: picks.team.shared.filter(one => one !== login),
    runsFor: Object.fromEntries(Object.entries(picks.team.runsFor).filter(([, one]) => one !== login)),
  }
  writePicks(path, { runs, ...(team ? { team } : {}) })
}

/** Give up the login under way: its `gh` stops waiting, and nothing of it is kept. */
export function stopLogin(root: string, files = jobFiles('login')): void {
  stopJob(files)
  rmSync(join(root, ADDING), { recursive: true, force: true })
  for (const path of [files.log, files.pid, files.exit]) rmSync(path, { force: true })
}

/**
 * The git settings that make git use the account in `dir` at GitHub, with no secret in them: an
 * empty helper drops every helper set before it (the person's keychain among them), then gh,
 * working in the account's folder only, answers git's ask for the login; a remote written for
 * ssh goes over https, where that login is the one asked. What a repository OpenAgent sends as
 * an account keeps in its own config.
 */
export function gitConfig(dir: string): [string, string][] {
  const quoted = `'${dir.replace(/'/g, `'\\''`)}'`
  return [
    [`credential.https://${HOST}.helper`, ''],
    [`credential.https://${HOST}.helper`, `!f() { test "$1" = get || exit 0; GH_TOKEN= GITHUB_TOKEN= GH_CONFIG_DIR=${quoted} gh auth git-credential get; }; f`],
    [`url.https://${HOST}/.insteadOf`, `git@${HOST}:`],
    [`url.https://${HOST}/.insteadOf`, `ssh://git@${HOST}/`],
  ]
}

/**
 * The environment to work as an account: its folder for `gh`, its token for `gh` and for git's
 * pushes and fetches to GitHub, whatever the person's own git keeps for it (the keychain, a
 * different helper, an ssh key). Set through git's environment, so nothing of the person's own
 * settings changes. The settings already in the environment are kept.
 *
 * Its name goes on the commits made in `commitsIn` alone, git directories as git's `gitdir:`
 * matches them (the run's project, or its session's folder): a file of the account's folder that
 * git includes there. Not git's own variables for a commit's author, which every repository a
 * command makes would take over its own: a project's tests that commit as their own user would
 * commit as the account. None given, or no facts kept: git signs as it would.
 */
export function runEnv(token: string, dir: string, facts: AccountFacts | undefined, env: NodeJS.ProcessEnv = process.env, commitsIn: readonly string[] = []): Record<string, string> {
  const given = Number(env['GIT_CONFIG_COUNT'] ?? 0) || 0
  const lines: [string, string][] = [
    // An empty helper drops every helper set before it; then one that answers with the token.
    [`credential.https://${HOST}.helper`, ''],
    [`credential.https://${HOST}.helper`, '!f() { test "$1" = get && echo username=x-access-token && echo "password=$GH_TOKEN"; }; f'],
    // A remote read over ssh goes over https too, where the token is the one asked.
    [`url.https://${HOST}/.insteadOf`, `git@${HOST}:`],
    [`url.https://${HOST}/.insteadOf`, `ssh://git@${HOST}/`],
  ]
  if (facts && commitsIn.length > 0) {
    const identity = writeIdentity(dir, facts)
    for (const gitDir of commitsIn) lines.push([`includeIf.gitdir:${gitDir}.path`, identity])
  }
  const out: Record<string, string> = { GH_CONFIG_DIR: dir, GH_TOKEN: token, GIT_CONFIG_COUNT: String(given + lines.length) }
  lines.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${given + i}`] = key
    out[`GIT_CONFIG_VALUE_${given + i}`] = value
  })
  return out
}

/**
 * The account's name on commits, as git reads it from a config file kept in its folder: its name
 * (its login when it has none) and GitHub's own address for it, which hides the person's own.
 */
function writeIdentity(dir: string, facts: AccountFacts): string {
  const quoted = (text: string) => `"${text.replace(/[\r\n]+/g, ' ').replace(/[\\"]/g, c => `\\${c}`)}"`
  const path = join(dir, 'commits.gitconfig')
  writeFile600(path, `[user]\n\tname = ${quoted(facts.name ?? facts.login)}\n\temail = ${quoted(`${facts.id}+${facts.login}@users.noreply.github.com`)}\n`)
  return path
}
