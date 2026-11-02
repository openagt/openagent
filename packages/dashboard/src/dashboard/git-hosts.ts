// A git host as its package answers for it (`<command> accounts`), read off what the package
// printed, and the host a project's remote is on: what the git hosts of Settings › Accounts are drawn from.

/** An account the git host's tool knows, as its package said it. */
export interface GitHostAccount {
  login: string
  /** The terminal's: the one the tool uses when not told which. */
  terminal: boolean
  /** The one OpenAgent's runs use. */
  runs: boolean
  /** Whether the tool could use it when asked. */
  ok: boolean
  /** On a server: the computer of the person's whose login it is. */
  from?: string
}

/** What a git host's package answers of it. */
export interface GitHostProvider {
  name: string
  /** The host's word for a pull request. */
  requestWord: string
  /** Its logo, an SVG. */
  logo?: string
  /** The tool it works through, by its command's name. */
  tool: string
  installed: boolean
  /** The command a press installs the tool with, shown under the button. */
  install: string
  accounts: GitHostAccount[]
  /** A login waiting for the browser's yes: the code the person types, and where. */
  loggingIn?: { code: string; url: string }
  /** The install a press started is going on. */
  installing?: boolean
  /** Why the last install failed, while the tool is still not here. */
  installFailed?: string
}

/** The host of a git remote's address: `git@host:path`, `ssh://user@host/path`, `https://host/path`. None for a local path. */
export function remoteHost(remote: string): string | undefined {
  const url = remote.trim()
  const scp = /^[^@/\s]+@([^:/\s]+):(?!\/\/)/.exec(url)
  if (scp) return scp[1]!.toLowerCase()
  try {
    const host = new URL(url).hostname
    return host ? host.toLowerCase() : undefined
  } catch {
    return undefined
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** A package's `accounts` answer, read: none for an answer that is not one. */
export function readProvider(output: unknown): GitHostProvider | undefined {
  if (!output || typeof output !== 'object') return undefined
  const said = output as Record<string, unknown>
  const name = text(said['name'])
  const tool = text(said['tool'])
  if (said['ok'] !== true || name === undefined || tool === undefined) return undefined
  const accounts: GitHostAccount[] = []
  for (const row of Array.isArray(said['accounts']) ? said['accounts'] : []) {
    const a = row as Record<string, unknown>
    const login = text(a['login'])
    if (login !== undefined) accounts.push({ login, terminal: a['terminal'] === true, runs: a['runs'] === true, ok: a['ok'] !== false })
  }
  const logo = text(said['logo'])
  const loggingIn = said['loggingIn'] as { code?: unknown; url?: unknown } | undefined
  const installFailed = text(said['installFailed'])
  return {
    name,
    requestWord: text(said['requestWord']) ?? 'pull request',
    // Only a picture: it is drawn as an image, never put in the page as markup.
    ...(logo?.trimStart().startsWith('<svg') ? { logo } : {}),
    tool,
    installed: said['installed'] === true,
    install: text(said['install']) ?? '',
    accounts,
    ...(typeof loggingIn?.code === 'string' && typeof loggingIn.url === 'string' && loggingIn.url.startsWith('https://') ? { loggingIn: { code: loggingIn.code, url: loggingIn.url } } : {}),
    ...(said['installing'] === true ? { installing: true } : {}),
    ...(installFailed !== undefined ? { installFailed } : {}),
  }
}

