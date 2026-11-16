// The tool behind the E2E stories' start and resume hooks (see README.md): a stand-in for
// whatever a project's hooks.yml names. The harness writes the fixture project's hooks file as
//
//   start:  node <this file> start
//   resume: node <this file> resume
//
// and this process does what such a tool does, offline: `start` and `resume` answer the run's id
// on stdout at once and leave the run to a detached process of their own; that process makes the
// run's checkout, drives agent-driver's scripted FakeDriver with the real session log and the
// real inbox, records the run on the data branch through the `logs` skill, and reclaims the
// checkout by the branches rule. So every file the dashboard reads is written by the same code a
// real run writes it with; only the coding agent is scripted.
//
// The prompt scripts the agent, by the words in it:
//   "hold"    the run waits for `<checkout>/.openagent/go` before its first turn, so a story
//             can act on a run that is certainly still working;
//   "ask"     the first turn ends on a question, so the run ends `waiting`;
//   "commit"  the run commits a file, so its branch holds work to push;
//   "agents"  the run starts subagents of both kinds (runs of its own, one of which fails, and its
//             coding agent's own) and keeps working until it is stopped; "many" starts more of them;
//   "fails"   the run fails, as a subagent that cannot do its job does.
// When `$OPENAGENT_E2E_STARTS_FILE` is set, every `start` and `resume` appends what its
// environment carried there, one JSON line each: the only place a story can see it.
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeDriver, QUESTION_TAG, continuationPrompt, logDiaryFile, parseQuestion, startEvent, type DriverEvent, type LogEndStatus, type SessionLog } from '@openagt/agent-driver'
import { nodeGitRunner } from '@openagt/agent-data'
import { childEndedLine, isPublish, type Publish } from '@openagt/agent-runner'
import { agentBranchName, attachCheckout, createCheckout, reclaimWorktree, worktreeBranch, worktreePath } from '@openagt/skill-branches'
import { findRun, parseRunCard, readDiary, writeRun, type AnyDiaryLine, type RunCard } from '@openagt/skill-logs'
import { agentIdFromStartedAt, startedAtFromAgentId } from '../agent-id.js'
import { OPENAGENT_DIR } from '../openagent-dir.js'

const QUESTION = { title: 'Which way?', options: [{ label: 'Left', detail: 'the short way' }, { label: 'Right' }], recommended: 'Left' }

const [mode, runId] = process.argv.slice(2)
const repo = process.cwd()
const git = nodeGitRunner()

function record(entry: Record<string, unknown>): void {
  const file = process.env['OPENAGENT_E2E_STARTS_FILE']
  if (file) appendFileSync(file, JSON.stringify(entry) + '\n')
}

/** The run's own process, detached from the hook line that answers for it. */
function detach(args: string[], env: NodeJS.ProcessEnv = process.env): void {
  spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { cwd: repo, detached: true, stdio: 'ignore', env }).unref()
}

/**
 * The runs an `agents` run starts for itself: the prompt (the task on the first line, the word that
 * scripts it after), how many seconds one that fails works first, and how long one that ends at once
 * ran (it was started that long ago), so a picture shows the times real runs take.
 */
const RUN_SUBAGENTS: Array<{ task: string; failsAfter?: number; ranFor?: number }> = [
  { task: 'Account page tests\n\nhold' },
  { task: 'Theme switch in the header\n\nhold' },
  { task: 'Read the theme tokens', ranFor: 200 },
  { task: 'Visual check in a browser\n\nfails', failsAfter: 9 },
]
/** What the runs of its own run on, on their cards. */
const RUN_MODEL = 'claude-sonnet-4-5'
/** Why the subagent that fails failed, as the line its main run is told says it. */
const FAILURE = 'Chrome did not start'
/** The subagents an `agents` run's coding agent starts inside its session: its name, whether it is still at work, ended or failed, and how many seconds it works first. */
const CALL_SUBAGENTS: Array<[string, 'working' | 'ended' | 'failed', number]> = [
  ['Find colours written by hand', 'working', 0],
  ['Settings page in dark', 'ended', 14],
  ['Map the order table', 'failed', 5],
]
/** What "many" adds: ended ones, so the list holds more than it shows at once. */
const MORE_SUBAGENTS = ['Order table contrast', 'Dark images for the avatars', 'Focus rings in dark', 'Charts in dark', 'Email preview in dark', 'Print styles', 'Docs for the switch', 'Changelog line']
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * What an `agents` run does before it holds: its prompt, a word on the plan, its coding agent's own
 * subagents (each a `subagent` event and the steps it took), and runs of its own started with it as
 * their parent. A run of its own that ends tells it how, as agent-runner tells a parent: a prompt.
 */
async function startSubagents(id: string, prompt: string, log: SessionLog, signal: AbortSignal): Promise<() => Promise<void>> {
  const write = (event: DriverEvent) => log.record(event)
  await write(startEvent(prompt, {}))
  // A look of its own first: a thought and two reads, one steps line in the chat.
  await write({ type: 'thought', text: 'Find the tokens first' })
  await write({ type: 'action', label: 'Read', detail: 'src/theme/tokens.css', id: 'toolu_own_read' })
  await write({ type: 'output', id: 'toolu_own_read', text: ':root { --bg: #fff; }' })
  await write({ type: 'action', label: 'Read', detail: 'src/account/Orders.tsx', id: 'toolu_own_orders' })
  await write({ type: 'output', id: 'toolu_own_orders', text: 'export function Orders() {}' })
  await write({ type: 'text', text: 'Three parts can go at once. I will start an agent on each and look for colours written by hand while they work.' })
  const calls = [...CALL_SUBAGENTS, ...(prompt.includes('many') ? MORE_SUBAGENTS.map((name, at) => [name, 'ended', 2 + at] as const) : [])]
  for (const [at, [name]] of calls.entries()) {
    const call = `toolu_${at}`
    await write({ type: 'action', label: 'Agent', detail: name, id: call })
    await write({ type: 'subagent', id: call, status: 'working', name, role: 'general-purpose', model: 'claude-haiku-4-5', prompt: `${name}.\nSay what you found in one paragraph.` })
    await write({ type: 'action', label: 'Read', detail: 'src/theme/tokens.css', id: `${call}_read`, subagent: call })
  }
  // One that is to say it ran a while was started that long ago: its id is made from that moment, as a row's start is read off it.
  const runs = RUN_SUBAGENTS.map(({ task, failsAfter, ranFor = 0 }, at) => ({ task, failsAfter, id: agentIdFromStartedAt(new Date(Date.now() - ranFor * 1000 + at).toISOString()) }))
  for (const { task, failsAfter, id: child } of runs) {
    detach(['run', child], { ...process.env, PROMPT: task, MODEL: RUN_MODEL, E2E_PARENT: id, ...(failsAfter ? { E2E_FAILS_AFTER: String(failsAfter) } : {}) })
  }
  // Each of its own that ends, after the seconds it works; and told of each run that ends on its own, once it has.
  return async () => {
    const ending = [...calls.entries()].filter(([, [, end]]) => end !== 'working').map(async ([at, [name, end, after]]) => {
      await sleep(after * 1000)
      if (signal.aborted) return
      await write({ type: 'text', text: `${name}: done.`, subagent: `toolu_${at}` })
      await write({ type: 'subagent', id: `toolu_${at}`, status: end, name })
    })
    for (const { task, id: child } of runs.filter(run => !run.task.includes('hold'))) {
      while (!signal.aborted) {
        const card = await findRun(repo, child).catch(() => undefined)
        if (card && card.status !== 'running') {
          await write(startEvent(childEndedLine({ id: child, status: card.status, ...(task.includes('fails') ? { detail: FAILURE } : {}) }), {}))
          break
        }
        await sleep(200)
      }
    }
    await Promise.all(ending)
  }
}

/** How far the run takes its work, on its card as agent-runner keeps it: the level its hook was given, none for `nothing`, else the one it had. */
function publishOf(given: string | undefined, had: unknown): { publish?: Publish } {
  if (isPublish(given)) return { publish: given }
  return given === undefined && isPublish(had) ? { publish: had } : {}
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

/** One session of the run in `checkout`: the prompt, the log, the inbox, the record, the reclaim. */
async function session(id: string, checkout: string, prompt: string, card: Omit<RunCard, 'status'>, continued: boolean): Promise<void> {
  const dir = join(checkout, OPENAGENT_DIR)
  // Hidden from git in this checkout alone, as the runner does: a `.gitignore` of `*`, the project's own kept.
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => {})
  const stop = new AbortController()
  process.on('SIGINT', () => stop.abort())
  process.on('SIGTERM', () => stop.abort())

  const driver = new FakeDriver({
    respond: (said, index) => {
      if (index === 0 && !continued && said.includes('ask')) return `I need a decision.\n\n\`\`\`${QUESTION_TAG}\n${JSON.stringify(QUESTION)}\n\`\`\`\n`
      return `done: ${said}`
    },
  })
  const { id: _id, ...startCard } = card
  const driverSession = await driver.start({ cwd: checkout, signal: stop.signal, log: { dir, card: { id, ...startCard }, continue: continued } })
  let status: LogEndStatus = 'done'
  let lastText = ''
  const fansOut = prompt.includes('agents') && !continued
  const told = fansOut ? await startSubagents(id, prompt, driverSession.log!, stop.signal) : undefined
  const ended = told?.()
  try {
    if (prompt.includes('fails')) {
      await sleep(Number(process.env['E2E_FAILS_AFTER'] ?? 0) * 1000)
      await driverSession.log!.record({ type: 'error', message: FAILURE })
      throw new Error(FAILURE)
    }
    if (prompt.includes('hold') || fansOut) {
      while (!stop.signal.aborted && !(await exists(join(dir, 'go')))) {
        // Its checkout removed under it (the demo's home gone): nothing is left to release it or to write to.
        if (!(await exists(checkout))) return
        await new Promise(r => setTimeout(r, 50))
      }
    }
    if (prompt.includes('commit') && !continued) {
      await writeFile(join(checkout, 'work.txt'), `${prompt}\n`)
      await git(['add', 'work.txt'], checkout)
      await git(['commit', '-q', '-m', 'the run\'s work'], checkout)
    }
    // Its prompt is in its log already, from before it held.
    if (!fansOut) lastText = (await driverSession.prompt(prompt, { inbox: join(dir, 'inbox.jsonl'), ...(continued ? { resume: true } : {}) })).text
  } catch {
    status = 'failed'
  }
  await ended
  if (stop.signal.aborted) status = 'stopped'
  else if (status === 'done' && parseQuestion(lastText)) status = 'waiting'

  const branch = (await worktreeBranch(checkout, git).catch(() => undefined)) ?? agentBranchName(id)
  const log = driverSession.log!
  await log.patch({ branch })
  await log.end(status)
  await log.settled()

  const written = parseRunCard(await readFile(join(dir, `${id}.json`), 'utf8'))
  const diary = (await readFile(join(dir, logDiaryFile(id)), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as AnyDiaryLine)
  if (written) await writeRun(repo, written, diary)
  if (status !== 'waiting') await reclaimWorktree(repo, checkout, { birthBranch: agentBranchName(id), git })
}

async function main(): Promise<void> {
  if (mode === 'start') {
    const id = agentIdFromStartedAt(new Date().toISOString())
    record({ hook: 'start', id, prompt: process.env['PROMPT'], driver: process.env['DRIVER'], model: process.env['MODEL'], publish: process.env['PUBLISH'], base: process.env['BASE'] })
    if ((process.env['PROMPT'] ?? '').includes('refuse')) {
      process.stderr.write('the project has no such command\n')
      process.exitCode = 1
      return
    }
    detach(['run', id])
    process.stdout.write(JSON.stringify({ ok: true, id }) + '\n')
    return
  }
  if (mode === 'resume') {
    const id = process.env['RUN_ID'] ?? ''
    record({ hook: 'resume', id, text: process.env['TEXT'], answer: process.env['ANSWER'], publish: process.env['PUBLISH'] })
    detach(['continue', id])
    process.stdout.write(JSON.stringify({ ok: true, id }) + '\n')
    return
  }
  if (mode === 'run' && runId) {
    const prompt = process.env['PROMPT'] ?? ''
    const checkout = await createCheckout(repo, { agentId: runId }, git)
    // A run started for another names it on its card, as agent-runner's `run --parent` does.
    const parent = process.env['E2E_PARENT']
    const caller = { pid: process.pid, host: hostname(), workspace: checkout.path, ...publishOf(process.env['PUBLISH'], undefined), ...(parent ? { parent } : {}) }
    // The coding agent named as agent-runner names it, its default when the start named none.
    // A subagent run started when its id says: one made from an earlier moment says on its card that it ran since then.
    const startedAt = (parent ? startedAtFromAgentId(runId) : undefined) ?? new Date().toISOString()
    await session(runId, checkout.path, prompt, { id: runId, startedAt, intent: prompt, driver: process.env['DRIVER'] ?? 'claude-code', ...(process.env['MODEL'] ? { model: process.env['MODEL'] } : {}), branch: checkout.branch, caller }, false)
    return
  }
  if (mode === 'continue' && runId) {
    const card = await findRun(repo, runId)
    if (!card) throw new Error(`no run ${runId}`)
    const kept = worktreePath(repo, runId)
    const checkout = (await exists(kept)) ? kept : (await attachCheckout(repo, { agentId: runId, branch: card.branch ?? agentBranchName(runId) }, git)).path
    // A checkout made again holds no diary: the recorded one is put back, so the log continues it.
    if (!(await exists(join(checkout, OPENAGENT_DIR, logDiaryFile(runId))))) {
      await mkdir(join(checkout, OPENAGENT_DIR), { recursive: true })
      await writeFile(join(checkout, OPENAGENT_DIR, logDiaryFile(runId)), ((await readDiary(repo, runId)) ?? []).map(line => JSON.stringify(line) + '\n').join(''))
    }
    const question = [...((await readDiary(repo, runId)) ?? [])].reverse().find(line => line.kind === 'question')
    const answer = process.env['ANSWER']
    const prompt = answer !== undefined ? continuationPrompt(String(question?.['title'] ?? ''), answer) : (process.env['TEXT'] ?? '')
    const { status: _status, endedAt: _endedAt, ...rest } = card
    const { publish: had, ...caller } = card.caller ?? {}
    await session(runId, checkout, prompt, { ...rest, caller: { ...caller, pid: process.pid, host: hostname(), workspace: checkout, ...publishOf(process.env['PUBLISH'], had) } }, true)
    return
  }
  throw new Error(`fake-run-bin: unknown mode ${mode}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
