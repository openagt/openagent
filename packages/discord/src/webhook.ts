import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * The webhook a message goes to, and the one POST that sends it. The webhook is set once per
 * machine (`discord setup`), in the user's config directory, never in a project: a URL that lets
 * anyone post to the channel has no business in a repository. `DISCORD_WEBHOOK` in the
 * environment wins over the saved one, so a container or a CI job sets it without a file.
 */

/** The environment variable that wins over the saved webhook. */
export const WEBHOOK_ENV = 'DISCORD_WEBHOOK'

/** Discord refuses a message over 2000 characters outright, so a longer one is cut. */
export const MAX_CONTENT = 2000

/** Where this machine's webhook is saved: `$XDG_CONFIG_HOME/skill-discord/webhook`, `~/.config` when that is unset. */
export function webhookFile(env: NodeJS.ProcessEnv): string {
  const config = env['XDG_CONFIG_HOME']?.trim() || join(homedir(), '.config')
  return join(config, 'skill-discord', 'webhook')
}

/** The webhook to post to and where it came from; none when neither place has one. */
export async function resolveWebhook(env: NodeJS.ProcessEnv): Promise<{ webhook: string; source: 'env' | 'saved' } | undefined> {
  const fromEnv = env[WEBHOOK_ENV]?.trim()
  if (fromEnv) return { webhook: fromEnv, source: 'env' }
  const saved = await readFile(webhookFile(env), 'utf8').then(text => text.trim(), () => '')
  return saved ? { webhook: saved, source: 'saved' } : undefined
}

/** Why a webhook cannot work, or nothing. Only the shape is checked: whether it posts is Discord's answer. */
export function invalidWebhook(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return 'that is not a URL'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'a webhook URL is http or https'
  return undefined
}

/**
 * Save this machine's webhook, readable by this user only: written to a new file of that mode and
 * renamed over the old one, so the URL is never in a file others can read, even for a moment.
 */
export async function saveWebhook(env: NodeJS.ProcessEnv, webhook: string): Promise<string> {
  const file = webhookFile(env)
  await mkdir(dirname(file), { recursive: true })
  const fresh = `${file}.${process.pid}.tmp`
  await writeFile(fresh, webhook.trim() + '\n', { mode: 0o600 })
  await rename(fresh, file)
  return file
}

/** Forget this machine's webhook. */
export async function clearWebhook(env: NodeJS.ProcessEnv): Promise<string> {
  const file = webhookFile(env)
  await rm(file, { force: true })
  return file
}

/** Cut to Discord's limit, saying so, so a cut message never reads as a whole one. Never inside a character: an emoji is kept whole or cut whole. */
export function clampContent(text: string): string {
  if (text.length <= MAX_CONTENT) return text
  const notice = '\n… (cut)'
  let end = MAX_CONTENT - notice.length
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end) + notice
}

export type PostOutcome = { ok: true } | { ok: false; detail: string }

/**
 * One message posted to the webhook. Mentions are not pinged: a message carrying a run's
 * question or a pull request's title would otherwise ping `@everyone` when the text says so.
 */
export async function postMessage(webhook: string, message: string, fetchImpl: typeof fetch = fetch): Promise<PostOutcome> {
  try {
    const res = await fetchImpl(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: clampContent(message), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return { ok: true }
    const body = await res.text().catch(() => '')
    return { ok: false, detail: `the webhook answered ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` }
  } catch (err) {
    // The error's own text can carry the URL (a bad one is quoted back whole), and the URL is the
    // secret: only its kind is said.
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return { ok: false, detail: timedOut ? 'the webhook did not answer within 15 seconds' : 'could not reach the webhook: the network failed, or the URL cannot be posted to' }
  }
}
