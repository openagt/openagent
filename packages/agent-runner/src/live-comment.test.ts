import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import type { GitHost } from './git-host.js'
import { ASSETS_URL, STEPS_SHOWN, durationWords, liveBody, openLiveComment, whoseTask, type LiveView } from './live-comment.js'

// The comment a run a row resumed keeps on its pull request: what it says while the run works and
// once it ended, how often it is rewritten, and a git host that could not post it.

/** A git host that keeps every comment write; `failPost` makes the first new comment fail. */
function commenting(failPost = false): GitHost & { writes: { to: string; body: string }[] } {
  const writes: { to: string; body: string }[] = []
  return {
    writes,
    requestOfBranch: async () => undefined,
    mergeRequest: async () => ({ outcome: 'failed', error: 'none' }),
    comment: async (_repo, to, body) => {
      writes.push({ to: 'edit' in to ? `edit ${to.edit}` : `post ${to.number}`, body })
      return failPost && !('edit' in to) && writes.length === 1 ? { error: 'gh: not logged in' } : { id: '501' }
    },
    branchUrl: async (_repo, branch) => `https://github.com/o/r/tree/${branch}`,
  }
}

const CLAUDE = `<img src="${ASSETS_URL}/claude.svg" width="16" height="16" align="top" alt="">`
const WORKING = `${CLAUDE} **Claude Code is working…** <img src="${ASSETS_URL}/working.svg" width="24" height="24" align="top" alt="">`
const view = (over: Partial<LiveView> = {}): LiveView => ({ on: { agent: 'claude-code' }, models: [], steps: [], ...over })
const action = (over: { summary?: string; id?: string; subagent?: string } = {}) => ({ type: 'action' as const, label: 'Bash', ...over })

test('while working: the coding agent and the moving logo, then the plan as a checklist, else the steps ticked once over', () => {
  assert.equal(liveBody(view()), WORKING, 'nothing under the head before a step: the comment only grows')
  assert.equal(liveBody(view({ steps: [{ words: 'Read the PR', done: true }, { words: 'Ran 2 commands', done: false }] })), `${WORKING}\n\n**Steps**\n- [x] Read the PR\n- [ ] Ran 2 commands`)
  const plan = [{ text: 'Read the PR', status: 'completed' as const }, { text: 'Change the line', status: 'in_progress' as const }, { text: 'Push', status: 'pending' as const }]
  assert.equal(liveBody(view({ plan, steps: [{ words: 'Read the PR', done: true }] })), `${WORKING}\n\n**Todo list**\n- [x] Read the PR\n- [ ] Change the line\n- [ ] Push`, 'the plan, over the steps')
  assert.match(liveBody(view({ plan: [], steps: [{ words: 'Read the PR', done: true }] })), /\*\*Steps\*\*/, 'an emptied plan: the steps again')
  const many = Array.from({ length: STEPS_SHOWN + 3 }, (_, i) => ({ words: `Step ${i + 1}`, done: true }))
  const shown = liveBody(view({ steps: many })).split('\n').filter(line => line.startsWith('- '))
  assert.equal(shown[0], '- [x] …3 earlier', 'the earlier steps are counted')
  assert.equal(shown.at(-1), `- [x] Step ${STEPS_SHOWN + 3}`)
  assert.equal(shown.length, STEPS_SHOWN + 1)
  assert.match(liveBody(view({ on: { agent: 'codex' } })), /^<picture><source media="\(prefers-color-scheme: dark\)" srcset="[^"]+\/codex-dark\.svg"><img src="[^"]+\/codex-light\.svg"[^>]*><\/picture> \*\*Codex is working…\*\*/)
  assert.match(liveBody(view({ on: { agent: 'fake' } })), /^\*\*fake is working…\*\*/, 'an agent with no logo: its id')
  assert.match(ASSETS_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/@openagt\/agent-runner@\d+\.\d+\.\d+\/assets$/, "this package's own version")
})

test("once ended: whose task it finished and in how long, the model by its agent's name, the effort and the branch, a rule, the checklist all ticked, then the answer", () => {
  const on = { agent: 'claude-code', model: 'claude-opus-5-5', effort: 'high', from: ['rom'] }
  const done = liveBody(view({ on, models: [{ id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5' }], steps: [{ words: 'Read the PR', done: true }, { words: 'Ran a command', done: false }] }), { status: 'done', text: '  Fixed it.  ', branch: { name: 'agent-fix', url: 'https://github.com/o/r/tree/agent-fix' }, ms: 133_000 })
  assert.equal(done, `${CLAUDE} **Claude Code finished @rom's task in 2m 13s** —— Opus 5.5 · high effort • [\`agent-fix\`](https://github.com/o/r/tree/agent-fix)\n\n---\n\n**Steps**\n- [x] Read the PR\n- [x] Ran a command\n\nFixed it.`)
  assert.equal(liveBody(view(), { status: 'done', text: 'Nothing to change.', ms: 5_000 }), `${CLAUDE} **Claude Code finished the task in 5s**\n\n---\n\nNothing to change.`, 'nobody named, no model, no branch')
  assert.equal(liveBody(view(), { status: 'done', text: 'x', branch: { name: 'agent-fix' }, ms: 0 }).split('\n')[0], `${CLAUDE} **Claude Code finished the task in 0s** —— \`agent-fix\``, 'a branch with no page: its name')
  assert.deepEqual([whoseTask(['rom', 'dani']), whoseTask(['rom', 'dani', 'lee'])], ["@rom and @dani's", "@rom, @dani and @lee's"])
  const long = liveBody(view(), { status: 'done', text: 'x'.repeat(70_000), ms: 0 })
  assert.ok(long.length < 65_536, 'GitHub takes the comment')
  assert.match(long, /\(cut: the answer is 70000 characters/)
  assert.deepEqual([durationWords(59_400), durationWords(3_600_000 + 240_000)], ['59s', '1h 4m'])
})

test('a failure says so with its reason in a block, and a stop says so; neither has an answer, and what was left open stays unticked', () => {
  const steps = [{ words: 'Read the PR', done: true }, { words: 'Ran a command', done: false }]
  assert.equal(liveBody(view({ steps }), { status: 'failed', text: 'half a thought', detail: 'agent exited 1\n```stack```', ms: 65_000 }), `${CLAUDE} **Claude Code encountered an error after 1m 5s**\n\n\`\`\`\nagent exited 1\n'''stack'''\n\`\`\`\n\n---\n\n**Steps**\n- [x] Read the PR\n- [ ] Ran a command`)
  assert.equal(liveBody(view(), { status: 'stopped', text: 'x', ms: 1_000 }), `${CLAUDE} **Claude Code was stopped after 1s**\n\n---`)
})

test("posted at once; a change after a quiet spell is written at once, then at most one rewrite a pause; a step is over when its call is; a subagent's calls are its own; the plan replaces the steps; no rewrite once the turn is over; the ending once, with the branch's page", async () => {
  const gitHost = commenting()
  const live = openLiveComment('/repo', 12, { agent: 'claude-code', from: ['rom'] }, { gitHost, log: () => {}, models: Promise.resolve([{ id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5' }]), everyMs: 60 })
  await sleep(5)
  assert.deepEqual(gitHost.writes, [{ to: 'post 12', body: WORKING }], 'posted before any step')
  live.onEvent({ type: 'model', model: 'claude-opus-5-5' })
  live.onEvent(action({ summary: 'Read the PR', id: 'c1' }))
  live.onEvent(action({ id: 'c2' }))
  live.onEvent(action({ id: 's1', subagent: 'agent-1' }))
  live.onEvent({ type: 'text', text: 'Thinking out loud' })
  await sleep(15)
  assert.deepEqual(gitHost.writes.slice(1), [{ to: 'edit 501', body: `${WORKING}\n\n**Steps**\n- [ ] Read the PR\n- [ ] Ran a command` }], 'the first change at once, the events that came with it in the same rewrite')

  live.onEvent({ type: 'output', id: 'c1', text: 'ok' })
  live.onEvent(action({ id: 'c3' }))
  live.onEvent({ type: 'output', id: 'c2', text: 'ok' })
  await sleep(15)
  assert.equal(gitHost.writes.length, 2, 'no second rewrite within the pause')
  await sleep(60)
  assert.equal(gitHost.writes.length, 3, 'one rewrite for what came within the pause')
  assert.equal(gitHost.writes[2]?.body, `${WORKING}\n\n**Steps**\n- [x] Read the PR\n- [ ] Ran 2 commands`)

  await sleep(70)
  live.onEvent({ type: 'output', id: 'c3', text: 'ok' })
  live.onEvent({ type: 'plan', tasks: [{ text: 'Read the PR', status: 'completed' }, { text: 'Push the fix', status: 'in_progress' }] })
  await sleep(15)
  assert.equal(gitHost.writes[3]?.body, `${WORKING}\n\n**Todo list**\n- [x] Read the PR\n- [ ] Push the fix`, 'after a quiet spell, at once')

  live.onEvent(action({ id: 'c4' }))
  live.onEvent({ type: 'plan', tasks: [{ text: 'Read the PR', status: 'completed' }, { text: 'Push the fix', status: 'completed' }] })
  live.onEvent({ type: 'result', text: 'Pushed the fix.' })
  // What its CLI says after the turn is over is no reason to rewrite.
  live.onEvent({ type: 'output', id: 'c4', text: 'late' })
  await sleep(90)
  assert.equal(gitHost.writes.length, 4, 'the turn is over: the ending is next, no rewrite before it')
  await live.end({ status: 'done', text: 'Pushed the fix.', branch: 'agent-fix' })
  await live.end({ status: 'failed', text: '', detail: 'too late' })
  assert.equal(gitHost.writes.length, 5, 'the ending comes once')
  assert.match(gitHost.writes[4]!.body, /^<img [^>]+> \*\*Claude Code finished @rom's task in \d+s\*\* —— Opus 5\.5 • \[`agent-fix`\]\(https:\/\/github\.com\/o\/r\/tree\/agent-fix\)\n\n---\n\n\*\*Todo list\*\*\n- \[x\] Read the PR\n- \[x\] Push the fix\n\nPushed the fix\.$/)
})

test('a comment that could not be posted is not rewritten on the way, and its ending is posted as a new one; the failure is a log line', async () => {
  const gitHost = commenting(true)
  const lines: string[] = []
  const live = openLiveComment('/repo', 12, { agent: 'claude-code' }, { gitHost, log: line => lines.push(line), everyMs: 10 })
  live.onEvent(action({ summary: 'Read the PR' }))
  await sleep(40)
  assert.equal(gitHost.writes.length, 1, 'nothing to rewrite')
  await live.end({ status: 'done', text: 'Answered.' })
  assert.deepEqual(gitHost.writes.map(w => w.to), ['post 12', 'post 12'])
  assert.match(gitHost.writes[1]!.body, /Answered\./)
  assert.deepEqual(lines, ['[agent-runner] the comment on pull request 12 could not be written: gh: not logged in'])
})
