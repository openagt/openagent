import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addWorktree, agentBranchName, worktreePath } from '@openagt/skill-branches'
import { nodeGitRunner } from '@openagt/agent-data'
import { OPENAGENT_DIR } from '../openagent-dir.js'
import { PROJECT_HOOKS_FILE } from '../project-hooks.js'
import { RUN_INBOX_FILE, sayToRun } from './run-inbox.js'

// The one case the RPC tests cannot stage: a run that ends while a line is on its way to it.

const RUN = '2026-07-19T10-00-00-000Z'

test('a line written to a run that ended meanwhile is taken back out of the inbox and resumes the run instead (#1774)', async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-run-inbox-')))
  const checkout = worktreePath(cwd, RUN)
  const inbox = join(checkout, OPENAGENT_DIR, RUN_INBOX_FILE)
  try {
    // A real checkout in a real repository: the run's inbox is found through the project's branches provider (#1774).
    const git = nodeGitRunner()
    await git(['init', '-q'], cwd)
    await git(['config', 'user.email', 't@t'], cwd)
    await git(['config', 'user.name', 't'], cwd)
    await writeFile(join(cwd, 'README'), 'x\n')
    await git(['add', '-A'], cwd)
    await git(['commit', '-q', '-m', 'init'], cwd)
    await addWorktree(cwd, { agentId: RUN, branch: agentBranchName(RUN) }, git)
    await mkdir(join(checkout, OPENAGENT_DIR), { recursive: true })
    await mkdir(join(cwd, OPENAGENT_DIR), { recursive: true })
    await writeFile(join(cwd, PROJECT_HOOKS_FILE), `resume: 'printf "%s|%s|%s\\n" "$RUN_ID" "\${TEXT-}" "\${ANSWER-}" >> resumed.txt; echo "{\\"id\\":\\"$RUN_ID\\"}"'\n`)
    // An earlier line the run never took waits there too: it goes first, in order.
    await writeFile(inbox, JSON.stringify({ kind: 'answer', question: 'Which way?', answer: 'Left' }) + '\n')

    // Working when the line is written, ended when looked at again.
    const answers = [true, false]
    const said = await sayToRun(cwd, RUN, { kind: 'message', text: 'also add tests' }, { isWorking: async () => answers.shift() ?? false })
    assert.deepEqual(said, { ok: true })
    assert.equal(await readFile(join(cwd, 'resumed.txt'), 'utf8'), `${RUN}||Left\n${RUN}|also add tests|\n`)
    assert.equal(await readFile(inbox, 'utf8').catch(() => ''), '', 'nothing is left in an inbox nobody reads')

    // Still working when looked at again: the line stays in the inbox, and nothing is resumed.
    assert.deepEqual(await sayToRun(cwd, RUN, { kind: 'message', text: 'one more' }, { isWorking: async () => true }), { ok: true })
    assert.deepEqual((await readFile(inbox, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as unknown), [{ kind: 'message', text: 'one more' }])
    assert.equal((await readFile(join(cwd, 'resumed.txt'), 'utf8')).split('\n').filter(Boolean).length, 2)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
