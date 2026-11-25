// A run's process in the E2E stories and the demo (see README.md): the scripted host
// (`fake-runs.ts`) spawns it detached, as agent-driver's host spawns `agent-runner run`, with
//
//   node <this file> run <id>        a fresh run: PROMPT, DRIVER, MODEL, PUBLISH in its environment
//   node <this file> continue <id>   a resume: TEXT or ANSWER, and PUBLISH
//
// and it does what `agent-runner run` does, offline: it makes the run's checkout, drives
// agent-driver's scripted FakeDriver with the real session log and the real inbox, records the
// run on the data branch through the `logs` skill, and reclaims the checkout by the branches
// rule. So every file the dashboard reads is written by the same code a real run writes it with;
// only the coding agent is scripted.
//
// The prompt scripts the agent, by the words in it:
//   "hold"    the run waits for `<checkout>/.openagent/go` before its first turn, so a story
//             can act on a run that is certainly still working;
//   "ask"     the first turn ends on a question, so the run ends `waiting`;
//   "commit"  the run commits a file, so its branch holds work to push;
//   "agents"  the run's coding agent starts subagents of its own, one of which fails, and the run
//             keeps working until it is stopped; "many" starts more of them;
//   "background" the run's coding agent leaves the test run going in the background and waits on
//             it, until `<checkout>/.openagent/go` (the run passes) or it is stopped;
//   "fails"   the run fails.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { FakeDriver, findRun, logDiaryFile, parseRunCard, readDiary, startEvent, writeRun, type AnyDiaryLine, type RunCard, NAME_FILE_ENV, givenName, isPublish, type Publish } from '@openagt/agent-driver'
import { type DriverEvent, type LogEndStatus, type SessionLog, continuationPrompt, OPENAGENT_DIR } from '@openagt/hooks'
import { parseQuestion, QUESTION_TAG } from '@openagt/ask/question'
import { nodeGitRunner } from '../git.js'
import { agentBranchName, attachCheckout, createCheckout, reclaimWorktree, worktreeBranch, worktreePath } from '@openagt/git-branches'

const QUESTION = { title: 'Which way?', options: [{ label: 'Left', detail: 'the short way' }, { label: 'Right' }], recommended: 'Left' }

const [mode, runId] = process.argv.slice(2)
const repo = process.cwd()
const git = nodeGitRunner()

/** Why a run that fails failed. */
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

/** What a `background` run does before it holds: its prompt, the test run it leaves going in the background, and its wait on it. */
async function startInBackground(prompt: string, log: SessionLog): Promise<void> {
  const command = 'pnpm test > /tmp/test.log 2>&1; echo exit=$?'
  await log.record(startEvent(prompt, {}))
  await log.record({ type: 'action', label: 'Bash', detail: command, summary: 'Run the whole suite', id: 'toolu_tests' })
  await log.record({ type: 'output', id: 'toolu_tests', text: 'Command running in background with ID: b1. You will be notified when it completes.' })
  await log.record({ type: 'text', text: 'The whole suite takes about 15 minutes. I will check its result when it finishes.' })
  await log.record({ type: 'background', tasks: [{ id: 'b1', description: 'Run the whole suite', command, since: new Date().toISOString() }] })
}

/**
 * What an `agents` run does before it holds: its prompt, a word on the plan, and its coding agent's
 * own subagents (each a `subagent` event and the steps it took).
 */
async function startSubagents(prompt: string, log: SessionLog, signal: AbortSignal): Promise<() => Promise<void>> {
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
  // Each that ends, after the seconds it works.
  return async () => {
    await Promise.all([...calls.entries()].filter(([, [, end]]) => end !== 'working').map(async ([at, [name, end, after]]) => {
      await sleep(after * 1000)
      if (signal.aborted) return
      await write({ type: 'text', text: `${name}: done.`, subagent: `toolu_${at}` })
      await write({ type: 'subagent', id: `toolu_${at}`, status: end, name })
    }))
  }
}

/** How far the run takes its work, on its card as agent-runner keeps it: the level it was given, none for `nothing`, else the one it had. */
function publishOf(given: string | undefined, had: unknown): { publish?: Publish } {
  if (isPublish(given)) return { publish: given }
  return given === undefined && isPublish(had) ? { publish: had } : {}
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

/**
 * The run's record, once there: the process of its first session takes the name its starter asked
 * for before it records the run, and an answer can come sooner. agent-runner's resume waits for
 * that process the same way.
 */
async function recorded(id: string): Promise<RunCard> {
  const until = Date.now() + 60_000
  for (;;) {
    const card = await findRun(repo, id)
    if (card) return card
    if (Date.now() > until) throw new Error(`no run ${id}`)
    await new Promise(r => setTimeout(r, 100))
  }
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
  const log = driverSession.log!
  // The name its starter asked for, taken beside the first turn as agent-runner takes it: the page
  // shows it for a while from the starter, and for good once the run's record has it. The scripted
  // agent asks no name of its own when the starter got none.
  const file = continued ? undefined : process.env[NAME_FILE_ENV]
  const named = file === undefined ? Promise.resolve() : givenName(file, stop.signal).then(title => (title === undefined || title === 'ask' ? undefined : log.title(title))).catch(() => {})
  let status: LogEndStatus = 'done'
  let lastText = ''
  const fansOut = prompt.includes('agents') && !continued
  const told = fansOut ? await startSubagents(prompt, log, stop.signal) : undefined
  const waitsOnCommand = prompt.includes('background') && !continued
  if (waitsOnCommand) await startInBackground(prompt, log)
  const ended = told?.()
  try {
    if (prompt.includes('fails')) {
      await log.record({ type: 'error', message: FAILURE })
      throw new Error(FAILURE)
    }
    if (prompt.includes('hold') || fansOut || waitsOnCommand) {
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
    // The run asks as one with ask on asks: its message's block is its question.
    // The images its start or its resume went with, as agent-runner hands them to the agent with the prompt.
    const images = process.env['IMAGES']?.split(',').filter(Boolean) ?? []
    if (waitsOnCommand && !stop.signal.aborted) {
      await log.record({ type: 'background', tasks: [] })
      await log.record({ type: 'text', text: 'All 665 tests pass.' })
      lastText = 'All 665 tests pass.'
    }
    if (!fansOut && !waitsOnCommand) lastText = (await driverSession.prompt(prompt, { inbox: join(dir, 'inbox.jsonl'), questionIn: parseQuestion, ...(continued ? { resume: true } : {}), ...(images.length > 0 ? { images } : {}) })).text
  } catch {
    status = 'failed'
  }
  await ended
  if (stop.signal.aborted) status = 'stopped'
  else if (status === 'done' && parseQuestion(lastText)) status = 'waiting'

  const branch = (await worktreeBranch(checkout, git).catch(() => undefined)) ?? agentBranchName(id)
  await log.patch({ branch })
  await log.end(status)
  // On the card before the record is copied, as agent-runner has it.
  await named
  await log.settled()

  const written = parseRunCard(await readFile(join(dir, `${id}.json`), 'utf8'))
  const diary = (await readFile(join(dir, logDiaryFile(id)), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as AnyDiaryLine)
  if (written) await writeRun(repo, written, diary)
  if (status !== 'waiting') await reclaimWorktree(repo, checkout, { birthBranch: agentBranchName(id), git })
}

async function main(): Promise<void> {
  if (mode === 'run' && runId) {
    const prompt = process.env['PROMPT'] ?? ''
    const checkout = await createCheckout(repo, { agentId: runId }, git)
    const caller = { pid: process.pid, host: hostname(), workspace: checkout.path, ...publishOf(process.env['PUBLISH'], undefined) }
    // The coding agent named as agent-runner names it, its default when the start named none.
    await session(runId, checkout.path, prompt, { id: runId, startedAt: new Date().toISOString(), intent: prompt, driver: process.env['DRIVER'] ?? 'claude-code', ...(process.env['MODEL'] ? { model: process.env['MODEL'] } : {}), branch: checkout.branch, caller }, false)
    return
  }
  if (mode === 'continue' && runId) {
    const card = await recorded(runId)
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
