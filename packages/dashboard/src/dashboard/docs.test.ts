import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDocs, DOC_CATEGORIES } from './docs.js'

test('readDocs surfaces the flat PLAN.md and the session-scoped PLAN_/TODO_ .agent.md files, in that order (#319/#323/#326)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'openagent-docs-'))
  try {
    await writeFile(join(cwd, 'TODO_my-branch.agent.md'), '- [ ] later\n')
    await writeFile(join(cwd, 'PLAN_my-branch.agent.md'), '# Plan\n')
    // A flat file coexists as a fallback and sorts before the scoped one in its group.
    await writeFile(join(cwd, 'PLAN.md'), '# Flat plan\n')
    // An unrelated .md is not surfaced.
    await writeFile(join(cwd, 'README.md'), '# Readme\n')
    const docs = await readDocs(cwd)
    assert.deepEqual(docs.map(d => d.name), ['PLAN.md', 'PLAN_my-branch.agent.md', 'TODO_my-branch.agent.md'])
    assert.equal(docs[0]!.content, '# Flat plan\n')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('the agent queue is not a document: a TODO_AGENTS.md at the root is never surfaced (#1774)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'openagent-docs-'))
  try {
    // The queue is a project package's data, read through that package's command and shown on its
    // own page; a copy at the root is neither the queue nor a document of the checkout.
    await writeFile(join(cwd, 'TODO_AGENTS.md'), '- [ ] stale checkout copy\n')
    await writeFile(join(cwd, 'PLAN.md'), '# Plan\n')
    assert.deepEqual((await readDocs(cwd)).map(d => d.name), ['PLAN.md'])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('readDocs skips missing and blank docs, and never throws', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'openagent-docs-'))
  try {
    await writeFile(join(cwd, 'PLAN.md'), '   \n\n')
    // PLAN.md blank, nothing else -> nothing surfaced.
    assert.deepEqual(await readDocs(cwd), [])
    // A workspace that does not exist reads as empty, not an error.
    assert.deepEqual(await readDocs(join(cwd, 'nope')), [])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('DOC_CATEGORIES match fixed roots + slug-only scoped names (no traversal)', () => {
  for (const cat of DOC_CATEGORIES) {
    // A flat root is a bare filename, never a path.
    if ('flat' in cat) assert.doesNotMatch(cat.flat, /[\\/]|\.\./)
    // The scoped pattern only admits a-z0-9- slugs, so no path separators slip in.
    assert.ok(!cat.scoped.test('PLAN_../evil.agent.md'))
    assert.ok(!cat.scoped.test('PLAN_a/b.agent.md'))
  }
  assert.ok(DOC_CATEGORIES[0]!.scoped.test('PLAN_my-branch.agent.md'))
  assert.ok(DOC_CATEGORIES[1]!.scoped.test('TODO_main-2.agent.md'))
  assert.ok(!('flat' in DOC_CATEGORIES[1]!), 'the TODO category has no flat file: the queue is not a document')
})
