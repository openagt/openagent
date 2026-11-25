import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DATA_BRANCH, nodeGitRunner } from '@openagt/git-branches'
import { writeSharing } from '@openagt/store-filesystem'
import { memorySettings, rpcHost } from '@openagt/hooks/testing'
import { list, meta, show } from './server.js'

const git = nodeGitRunner()

test("the server part reads this machine's copy of the tickets as the command does: every row, one ticket by its file or its path with its plan, and the import stamp", async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'tickets-server-')))
  try {
    await git(['init', '-q', '-b', 'main'], repo)
    await git(['config', 'user.email', 's@s'], repo)
    await git(['config', 'user.name', 's'], repo)
    await git(['commit', '-q', '--allow-empty', '-m', 'init'], repo)
    // Its records shared on its agent-data branch, the person's yes given once.
    await writeSharing(repo, true)
    const host = rpcHost({ root: repo, settings: memorySettings() })
    assert.deepEqual(await list(host, {}), [], 'no agent-data branch: no tickets')
    assert.deepEqual(await meta(host, {}), {})
    const commit = (await git(['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'create the agent-data branch'], repo)).trim()
    await git(['checkout', '-q', '-B', DATA_BRANCH, commit], repo)
    await mkdir(join(repo, 'tickets'))
    await writeFile(join(repo, 'tickets', '2026-08-30_a.md'), 'Priority: 8\n\n# A\n\n## TLDR\n\nThe first.\n')
    await writeFile(join(repo, 'tickets', '2026-08-29_b.md'), '# B\n')
    await writeFile(join(repo, 'tickets', '2026-08-29_b.plan.md'), 'Effort: 1\n\n# [Plan] B\n')
    await writeFile(join(repo, 'tickets', 'meta.json'), '{"lastImportedAt":"2026-09-01T00:00:00.000Z"}\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-q', '-m', 'seed'], repo)
    await git(['checkout', '-q', 'main'], repo)
    assert.deepEqual((await list(host, {})).map(ticket => [ticket.file, ticket.title, ticket.planned]), [['2026-08-30_a.md', 'A', false], ['2026-08-29_b.md', 'B', true]], 'in the order the command lists them')
    const shown = await show(host, { file: 'tickets/2026-08-29_b.md' })
    assert.equal(shown?.ticket.content, '# B\n')
    assert.equal(shown?.plan, 'Effort: 1\n\n# [Plan] B\n')
    assert.equal((await show(host, { file: '2026-08-30_a.md' }))?.plan, undefined, 'by its bare file too, with no plan')
    assert.equal(await show(host, { file: '2026-08-31_gone.md' }), null, 'a ticket the project does not have')
    assert.equal(await show(host, { file: '../README.md' }), null, 'nor anything that is no ticket')
    assert.deepEqual(await meta(host, {}), { lastImportedAt: '2026-09-01T00:00:00.000Z' })
  } finally {
    await rm(repo, { recursive: true, force: true, maxRetries: 10 })
  }
})
