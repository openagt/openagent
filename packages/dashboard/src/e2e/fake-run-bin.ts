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
//   "commit"  the run commits a file, so its branch holds work to push.
// When `$OPENAGENT_E2E_STARTS_FILE` is set, every `start` and `resume` appends what its
// environment carried there, one JSON line each: the only place a story can see it.
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeDriver, QUESTION_TAG, continuationPrompt, logDiaryFile, parseQuestion, type LogEndStatus } from '@openagt/agent-driver'
import { nodeGitRunner } from '@openagt/agent-data'
import { NAME_FILE_ENV, givenName, isPublish, type Publish } from '@openagt/agent-runner'
import { agentBranchName, attachCheckout, createCheckout, reclaimWorktree, worktreeBranch, worktreePath } from '@openagt/skill-branches'
import { findRun, parseRunCard, readDiary, writeRun, type AnyDiaryLine, type RunCard } from '@openagt/skill-logs'
import { agentIdFromStartedAt } from '../agent-id.js'
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
function detach(args: string[]): void {
  spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { cwd: repo, detached: true, stdio: 'ignore', env: process.env }).unref()
}

/** How far the run takes its work, on its card as agent-runner keeps it: the level its hook was given, none for `nothing`, else the one it had. */
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
  try {
    if (prompt.includes('hold')) {
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
    lastText = (await driverSession.prompt(prompt, { inbox: join(dir, 'inbox.jsonl'), ...(continued ? { resume: true } : {}) })).text
  } catch {
    status = 'failed'
  }
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
