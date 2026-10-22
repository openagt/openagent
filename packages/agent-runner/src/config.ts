import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { excludeFromGit } from '@openagt/agent-data'
import { PERSONAL_PARTS, type PersonalSetup } from '@openagt/agent-driver'
import { isMap, parseDocument } from 'yaml'
import { RUNNER_CONFIG, RUNNER_DIR } from './names.js'

/**
 * This machine's settings for the tool: `.agent-runner/config.yml` in the project, hidden from git
 * with the rest of the directory. A missing file is no settings; a file that cannot be read as a
 * YAML map is one line on `log` and no settings either, so a broken file never stops a run.
 */
export async function readConfig(repo: string, log: (line: string) => void): Promise<Record<string, unknown>> {
  const file = configFile(repo)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return {}
  }
  const doc = parseDocument(raw)
  if (doc.errors.length > 0) {
    log(`[agent-runner] ${file}: ${doc.errors[0]!.message.split('\n')[0]}`)
    return {}
  }
  const top: unknown = doc.toJS()
  if (top !== null && (typeof top !== 'object' || Array.isArray(top))) {
    log(`[agent-runner] ${file}: the file is not a YAML map`)
    return {}
  }
  return (top as Record<string, unknown> | null) ?? {}
}

/** Where this machine's settings file is in the project, for the lines that name it. */
export function configFile(repo: string): string {
  return join(repo, RUNNER_DIR, RUNNER_CONFIG)
}

/**
 * Which parts of the person's own setup this machine's runs load: the `personal:` map in the
 * config, one line per part (`memory: off`). A part is on unless its line says off, so a run
 * loads what the coding agent loads when started by hand; anything else in the map is said on
 * `log` and changes nothing.
 */
export async function readPersonal(repo: string, log: (line: string) => void): Promise<PersonalSetup> {
  const setup: PersonalSetup = { memory: true, connectors: true, skills: true }
  const value = (await readConfig(repo, log))['personal']
  if (value === undefined || value === null) return setup
  const file = configFile(repo)
  if (typeof value !== 'object' || Array.isArray(value)) {
    log(`[agent-runner] ${file}: \`personal\` is not a map of ${PERSONAL_PARTS.join(', ')}`)
    return setup
  }
  for (const [part, on] of Object.entries(value)) {
    if (!(PERSONAL_PARTS as readonly string[]).includes(part)) log(`[agent-runner] ${file}: \`personal\` has no part \`${part}\`; the parts are ${PERSONAL_PARTS.join(', ')}`)
    else if (on === 'off' || on === false) setup[part as keyof PersonalSetup] = false
    else if (on !== null && on !== 'on' && on !== true) log(`[agent-runner] ${file}: \`personal.${part}\` is not on or off`)
  }
  return setup
}

/**
 * The accounts this project's runs work as, when not the computer's: the `accounts:` map in the
 * config, kept on this machine only, since whose accounts a project uses is the person's, not the
 * project's. `git-host` names the account at the git host, `claude-code` the Claude accounts, in
 * the order they are tried. Anything else in the map is said on `log` and changes nothing.
 */
export interface ProjectAccounts {
  gitHost?: string
  claude?: string[]
}

/** The keys of the `accounts:` map, by what each names. */
const ACCOUNT_KEYS = { gitHost: 'git-host', claude: 'claude-code' } as const

export async function readProjectAccounts(repo: string, log: (line: string) => void): Promise<ProjectAccounts> {
  const value = (await readConfig(repo, log))['accounts']
  if (value === undefined || value === null) return {}
  const file = configFile(repo)
  if (typeof value !== 'object' || Array.isArray(value)) {
    log(`[agent-runner] ${file}: \`accounts\` is not a map of ${Object.values(ACCOUNT_KEYS).join(', ')}`)
    return {}
  }
  const map = value as Record<string, unknown>
  const accounts: ProjectAccounts = {}
  const host = map[ACCOUNT_KEYS.gitHost]
  if (typeof host === 'string' && host.trim()) accounts.gitHost = host.trim()
  else if (host !== undefined && host !== null) log(`[agent-runner] ${file}: \`accounts.${ACCOUNT_KEYS.gitHost}\` is not an account`)
  const claude = map[ACCOUNT_KEYS.claude]
  if (Array.isArray(claude) && claude.every(name => typeof name === 'string') && claude.length > 0) accounts.claude = claude as string[]
  else if (claude !== undefined && claude !== null) log(`[agent-runner] ${file}: \`accounts.${ACCOUNT_KEYS.claude}\` is not a list of account names`)
  for (const key of Object.keys(map)) if (!(Object.values(ACCOUNT_KEYS) as string[]).includes(key)) log(`[agent-runner] ${file}: \`accounts\` has no \`${key}\``)
  return accounts
}

/**
 * Change the project's accounts: a value sets one, `null` takes it out, so the computer's are used
 * again. The rest of the file stays as the person wrote it, comments too; the directory is hidden
 * from git as a run hides it.
 */
export async function writeProjectAccounts(repo: string, change: { gitHost?: string | null; claude?: string[] | null }): Promise<void> {
  const file = configFile(repo)
  const doc = parseDocument(await readFile(file, 'utf8').catch(() => ''))
  if (doc.errors.length > 0) throw new Error(`${file} does not read as YAML: ${doc.errors[0]!.message.split('\n')[0]}`)
  for (const [field, key] of Object.entries(ACCOUNT_KEYS) as [keyof typeof ACCOUNT_KEYS, string][]) {
    const value = change[field]
    if (value === undefined) continue
    if (value === null || (Array.isArray(value) && value.length === 0)) doc.deleteIn(['accounts', key])
    else doc.setIn(['accounts', key], value)
  }
  const accounts = doc.get('accounts')
  if (isMap(accounts) && accounts.items.length === 0) doc.delete('accounts')
  await mkdir(dirname(file), { recursive: true })
  const top = doc.contents
  await writeFile(file, top === null || (isMap(top) && top.items.length === 0 && !doc.commentBefore && !doc.comment) ? '' : doc.toString())
  await excludeFromGit(repo, `/${RUNNER_DIR}`).catch(() => {})
}
