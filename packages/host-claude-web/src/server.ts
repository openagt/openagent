import { act, read, type RpcComputerHost, type RpcHost } from '@openagt/hooks/rpc'
import { isRunId } from '@openagt/skill-logs'
import { bridgeBrowser } from './bridge.js'
import { bridgeExtensionSource, type BridgeBrowserAction, type BridgeBrowserStatus } from './bridge-browser.js'
import type { BridgeEvent, BridgeHello, BridgeQuestion } from './bridge-endpoints.js'
import { bridgeQuestions, type BridgeAnswer, type BridgeContact, type BridgeVersion } from './bridge-store.js'
import { BROWSER } from './settings.js'
import { claudeWebDir, readToken } from './token.js'
import { findWebRun } from './web-runs.js'

// host-claude-web's server part (`@openagt/hooks/rpc`): what the strip above a web run's chat reads
// and answers with, in the run's project; and what the plugin's Settings entry reads and saves, in
// none, since the bridge is this computer's. What a caller sends is checked here, whatever its
// type says: it comes from a page.

/** A web run, as the strip above its chat shows it. */
export interface WebRunView {
  /** The cloud session the hand-off made; none while it is under way, or when it failed. */
  session?: { id: string; url: string }
  /** The question the session is parked on, as the bridge holds it. */
  question?: BridgeQuestion
  /** The pick on its way to the session, or how it went. */
  answer?: BridgeAnswer
  /** What the session said, as the extension read it off its page: a best-effort mirror. */
  mirror: BridgeEvent[]
}

/** The run `agentId` of the project, when it ran as a cloud session; null for any other. */
export const run = read(async (host: RpcHost, input: { agentId: string }): Promise<WebRunView | null> => {
  const found = isRunId(String(input.agentId)) ? await findWebRun(host.root, input.agentId) : undefined
  if (!found) return null
  if (!found.session) return { mirror: [] }
  const store = bridgeQuestions()
  const question = store.get(found.session.id)
  const answer = store.answer(found.session.id)
  return { session: found.session, ...(question ? { question } : {}), ...(answer ? { answer } : {}), mirror: store.events(found.session.id) }
})

/**
 * Answer the question the run's session is parked on (#1237, #1554): the pick is queued for the
 * extension, which types it into the session. Only the labels of the question parked are taken,
 * so nothing but what the session itself offered is ever typed there.
 */
export const answer = act(async (host: RpcHost, input: { agentId: string; labels: string[] }): Promise<{ ok: true } | { ok: false; error: string }> => {
  const session = await sessionOf(host, input.agentId)
  if (!session) return { ok: false, error: 'This run has no cloud session to answer.' }
  if (!Array.isArray(input.labels) || !input.labels.every(label => typeof label === 'string' && label.trim() !== '')) return { ok: false, error: 'An answer is the labels of the options picked.' }
  const queued = bridgeQuestions().queueAnswer(session, input.labels)
  return typeof queued === 'string' ? { ok: false, error: queued } : { ok: true }
})

/** Take a pick back while no extension has collected it. */
export const cancel = act(async (host: RpcHost, input: { agentId: string }): Promise<{ ok: boolean }> => {
  const session = await sessionOf(host, input.agentId)
  return { ok: session !== undefined && bridgeQuestions().cancelAnswer(session) }
})

/** The run's cloud session, by its id. */
async function sessionOf(host: RpcHost, agentId: unknown): Promise<string | undefined> {
  if (typeof agentId !== 'string' || !isRunId(agentId)) return undefined
  return (await findWebRun(host.root, agentId))?.session?.id
}

/** The bridge, as the plugin's Settings entry shows it. */
export interface BridgeView {
  /** Which browser does the extension's work. */
  browser: 'app' | 'yours'
  /** Where the browser OpenAgent runs stands. */
  browserState: BridgeBrowserStatus
  /** The folder a person loads the extension from into their own Chrome; none where this package has none. */
  folder?: string
  /** The last call anything made of the bridge, and how it went: a refused one too, which proves something is trying. */
  lastContact?: BridgeContact
  /** The version the extension last said it is, and whether it was refused for it (#1519). */
  version?: BridgeVersion
  /** What the extension's page script last said of itself. */
  page?: BridgeHello
  /** How many questions the bridge holds. */
  questions: number
}

/** Where the bridge stands on this computer. */
export const bridge = read(async (host: RpcComputerHost, _input: object): Promise<BridgeView> => {
  const store = bridgeQuestions()
  const folder = bridgeExtensionSource()?.dir
  const lastContact = store.lastContact()
  const version = store.version()
  const page = store.hello()
  return {
    browser: await host.settings.get(BROWSER),
    browserState: (await bridgeBrowser()?.status()) ?? { state: 'off' },
    ...(folder ? { folder } : {}),
    ...(lastContact ? { lastContact } : {}),
    ...(version ? { version } : {}),
    ...(page ? { page } : {}),
    questions: store.list().length,
  }
})

/**
 * The bridge's key, for a person to paste into the extension in their own Chrome. An act, not a
 * read: a device that may only watch this computer never has it.
 */
export const token = act(async (_host: RpcComputerHost, _input: object): Promise<string | null> => (await readToken(claudeWebDir())) ?? null)

/** Pick which browser does the extension's work: the one OpenAgent runs starts with the pick, and stops with the other. */
export const pickBrowser = act(async (host: RpcComputerHost, input: { browser: 'app' | 'yours' }): Promise<void> => {
  if (input.browser !== 'app' && input.browser !== 'yours') throw new Error('The browser is OpenAgent’s or yours.')
  await host.settings.set(BROWSER, input.browser)
  const browser = bridgeBrowser()
  if (input.browser === 'app') void browser?.start()
  else await browser?.stop()
})

/** Show the browser OpenAgent runs, for the one sign-in, hide it again, or restart it. */
export const browserAction = act(async (_host: RpcComputerHost, input: { action: BridgeBrowserAction }): Promise<void> => {
  if (!['show', 'hide', 'restart'].includes(input.action)) throw new Error('The browser is shown, hidden or restarted.')
  await bridgeBrowser()?.act(input.action)
})
