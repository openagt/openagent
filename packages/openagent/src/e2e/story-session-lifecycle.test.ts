import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeWorld, waitFor, release, git } from './harness.js'
import { onAgent, onAgents, onAgentHandoff, onAgentWorktree, onRetainedWorktrees, onActivity, onRecentAgents } from '../dashboard-rpc/reads.js'
import { onCommands } from '../dashboard-rpc/projects.js'
import { sendStart } from '../dashboard-rpc/control.js'
import { PROJECT_HOOKS_FILE } from '../project-hooks.js'

// The run lifecycle stories (README.md): what a user sees between clicking Start and reading the
// recorded run's row — through the same RPCs the dashboard calls, the project's own start hook,
// and a real detached run process with the fake driver in the agent seat.

test('start a run through the project\'s start hook, watch it live, and read the recorded row when it ends', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    const agentId = await world.startAgent(project, 'Add a login page and commit it', { driver: 'codex', model: 'gpt-5', publish: 'merge', base: 'main' })
    const tail = await world.tailAgent(project, agentId)

    // The hook line got the prompt and the person's picks in its environment, and the id it
    // answered is the run's. The run is detached, so the recorded call is the only place this
    // contract is observable. The project has no git host package, so no pull request can be
    // opened: the level picked, merge, is handed over as the furthest the project goes, the branch.
    const call = (await world.hookCalls())[0]!
    assert.deepEqual(call, { hook: 'start', id: agentId, prompt: 'Add a login page and commit it', driver: 'codex', model: 'gpt-5', publish: 'branch', base: 'main' })

    // The feed is the run's own diary, tailed from the moment of the Start, before the run's
    // checkout exists: the agent's reply, then the end.
    const end = await waitFor(() => tail.events.find(e => e.kind === 'end'), 'the end event')
    assert.equal(end.kind === 'end' && end.ok, true)
    assert.ok(tail.events.some(e => e.kind === 'driver' && e.event.type === 'text' && e.event.text.includes('Add a login page')), 'the agent\'s reply reached the feed')
    tail.stop()

    // The sidebar row settles to done, carrying what the list renders: the prompt as the label,
    // the branch the work is on, and the coding agent and model the run's card names.
    const meta = await world.waitAgent(project, agentId, 'done')
    assert.equal(meta.intent, 'Add a login page and commit it')
    assert.equal(meta.branch, `agent-${agentId}`)
    assert.equal(meta.driver, 'codex')
    assert.equal(meta.model, 'gpt-5')

    // The run's tool reclaimed the checkout and published nothing: nothing is left to remove,
    // and the branch is on this machine only.
    await world.waitRetired(project, agentId)
    assert.deepEqual(await rpc(onRetainedWorktrees)(project.id), [])
    assert.ok((await git(project.cwd, 'branch', '--list', `agent-${agentId}`)).includes(`agent-${agentId}`), 'the run\'s branch is still here')
    assert.equal((await git(project.cwd, 'ls-remote', '--heads', 'origin')).includes(`agent-${agentId}`), false, 'and not on origin')
    // Its header then says only what is true of the run: the branch it recorded, and no checkout
    // to be clean or dirty. Never the user's own checkout's branch and "clean".
    assert.deepEqual(await rpc(onAgentWorktree)(project.id, agentId), { branch: `agent-${agentId}` })

    // The recorded run replays the story the live tail told, and the cross-project surfaces list it.
    const replay = await waitFor(async () => {
      const events = await rpc(onAgent)(project.id, agentId)
      return events.some(e => e.kind === 'end') ? events : undefined
    }, 'the recorded replay to carry the whole diary')
    assert.ok(replay.some(e => e.kind === 'driver' && e.event.type === 'text'))
    const activity = await rpc(onActivity)()
    assert.ok(activity.items.some(a => a.agentId === agentId && a.kind === 'finished' && a.status === 'done'))
    // The feed also names the project as read whole, which is what lets the browser's notifier tell
    // this apart from a poll that simply could not reach it (#1625).
    assert.ok(activity.whole.includes(project.id))
    assert.ok((await rpc(onRecentAgents)()).some(r => r.projectId === project.id && r.agent.id === agentId))

    // The handoff panel reads the branch off the repository: it exists, and it is not pushed.
    const handoff = await waitFor(async () => {
      const panel = await rpc(onAgentHandoff)(project.id, agentId)
      return panel?.exists ? panel : undefined
    }, 'the panel to report the branch')
    assert.equal(handoff.branch, `agent-${agentId}`)
    assert.equal(handoff.pushed, false, 'the run published nothing')
  } finally {
    await world.close()
  }
})

test('two runs at once, each in its own checkout (#736)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    // Both runs hold before their first turn, so both are provably working at the same time. A
    // person's Start has no cap: the click is the brake.
    const runA = await world.startAgent(project, 'hold: first feature')
    const runB = await world.startAgent(project, 'hold: second feature')
    assert.notEqual(runA, runB)
    await world.waitAgent(project, runA, 'running')
    await world.waitAgent(project, runB, 'running')

    // Both rows are live in the sidebar, and each names its own checkout under the project's
    // worktrees dir — the user's checkout is neither.
    const agents = await rpc(onAgents)(project.id)
    assert.equal(agents.filter(r => [runA, runB].includes(r.id) && r.status === 'running').length, 2)
    const [wtA, wtB] = [await rpc(onAgentWorktree)(project.id, runA), await rpc(onAgentWorktree)(project.id, runB)]
    assert.ok(wtA?.checkout && wtB?.checkout, 'each run reports a checkout of its own')
    assert.notEqual(wtA.checkout.path, wtB.checkout.path)
    assert.notEqual(wtA.checkout.path, project.cwd)

    // Each goes on and finishes on its own.
    for (const agentId of [runA, runB]) {
      await release(project, agentId)
      assert.equal((await world.waitAgent(project, agentId, 'done')).status, 'done')
    }
  } finally {
    await world.close()
  }
})

test('a checkout git can no longer read, as one being removed, still answers with the run\'s branch', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    const agentId = await world.startAgent(project, 'hold: a change')
    await world.waitAgent(project, agentId, 'running')
    const path = (await rpc(onAgentWorktree)(project.id, agentId))?.checkout?.path
    assert.ok(path, 'the run has a checkout')
    // What the run's clean-up leaves for a moment: the folder is there, git cannot read it. An
    // answer without the branch put the bar above the message box away until the next read.
    // A checkout's `.git` is a file naming where its repository is: pointed nowhere, git fails
    // there rather than reading the project's own checkout above it.
    const gitFile = join(path, '.git')
    const was = await readFile(gitFile, 'utf8')
    await writeFile(gitFile, 'gitdir: /nowhere\n')
    assert.deepEqual(await rpc(onAgentWorktree)(project.id, agentId), { branch: `agent-${agentId}` })
    // Gone first, as a removal may take it: never the project's own branch, which git reads then.
    await rm(gitFile)
    assert.deepEqual(await rpc(onAgentWorktree)(project.id, agentId), { branch: `agent-${agentId}` })
    await writeFile(gitFile, was)
    await release(project, agentId)
    await world.waitAgent(project, agentId, 'done')
  } finally {
    await world.close()
  }
})

test('a project without a start hook cannot start a run, and a hook that fails says why (#1774)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    // The launcher reads whether the project has the line, to switch Start off with the reason.
    assert.equal((await rpc(onCommands)(project.id))?.startHook, true)
    assert.equal((await rpc(onCommands)(project.id))?.gitHost, false, 'and whether a pull request can be opened here, for its publish menu')

    // The tool's own refusal: its last line on stderr is what the person reads.
    assert.deepEqual(await rpc(sendStart)(project.id, 'refuse this one'), { ok: false, error: 'the start hook: the project has no such command' })

    await rm(join(project.cwd, PROJECT_HOOKS_FILE))
    assert.equal((await rpc(onCommands)(project.id))?.startHook, false)
    assert.deepEqual(await rpc(sendStart)(project.id, 'Add a login page'), { ok: false, error: 'this project has no start hook' })
    assert.deepEqual(await rpc(onAgents)(project.id), [], 'nothing was started')
  } finally {
    await world.close()
  }
})
