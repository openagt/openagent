import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { rpcKind, type RpcHost } from '@openagt/hooks/rpc'
import { memorySettings, rpcHost } from '@openagt/hooks/testing'
import { LIMITS, savedPromptsFrom } from './saved.js'
import { prompts, remove, save } from './server.js'
import { PERSON_PROMPTS, PROJECT_PROMPTS } from './settings.js'

// The message box's saved prompts, through saved-prompts' functions, against settings kept in memory:
// the person's in every project and in a session with no project, a project's in that project alone.

const SHOP = { id: 'shop', name: 'shop', dir: '/work/shop' }
const DOCS = { id: 'docs', name: 'docs', dir: '/work/docs' }

/** Calls in `project`, or in a session with no project, over one person's settings. */
function hosts(): { in: (project: typeof SHOP | undefined) => RpcHost } {
  const settings = memorySettings()
  return { in: project => rpcHost({ settings, root: project?.dir ?? '/sessions', project: async () => project }) }
}

test('the list only reads; saving and deleting change something', () => {
  assert.equal(rpcKind(prompts), 'read')
  assert.equal(rpcKind(save), 'act')
  assert.equal(rpcKind(remove), 'act')
})

test("a prompt saved as the person's is offered in every project and in a session with no project; one saved as a project's, in that project alone (#2394)", async () => {
  const { in: at } = hosts()
  const review = await save(at(SHOP), { label: ' Deep review ', text: ' Audit this PR. ', whose: 'person' })
  assert.deepEqual({ label: review.label, text: review.text }, { label: 'Deep review', text: 'Audit this PR.' })
  assert.match(review.id, /^[0-9a-f-]{36}$/)
  const notes = await save(at(SHOP), { label: 'Release notes', text: 'Write the notes.', whose: 'project' })
  assert.deepEqual(await prompts(at(SHOP), {}), { person: [review], project: [notes] })
  assert.deepEqual(await prompts(at(DOCS), {}), { person: [review], project: [] })
  assert.deepEqual(await prompts(at(undefined), {}), { person: [review] })
  // Each is kept where its setting says: the person's with them, the project's with the project.
  assert.deepEqual(await at(SHOP).settings.get(PROJECT_PROMPTS, SHOP), [notes])
  assert.deepEqual(await at(undefined).settings.get(PERSON_PROMPTS), [review])
})

test("a deleted prompt is no longer offered, and only the one named goes; one already gone deletes nothing (#2394)", async () => {
  const { in: at } = hosts()
  const first = await save(at(SHOP), { label: 'First', text: 'one', whose: 'person' })
  const second = await save(at(SHOP), { label: 'Second', text: 'two', whose: 'person' })
  const shared = await save(at(SHOP), { label: 'Shared', text: 'three', whose: 'project' })
  await remove(at(DOCS), { whose: 'person', id: first.id })
  await remove(at(SHOP), { whose: 'project', id: first.id })
  assert.deepEqual(await prompts(at(SHOP), {}), { person: [second], project: [shared] })
  await remove(at(SHOP), { whose: 'project', id: shared.id })
  await remove(at(SHOP), { whose: 'project', id: shared.id })
  assert.deepEqual(await prompts(at(SHOP), {}), { person: [second], project: [] })
})

test('what cannot be saved is said, and nothing is saved: no name, no text, too long, no room, no project, whose it is unsaid (#2394)', async () => {
  const { in: at } = hosts()
  await assert.rejects(save(at(SHOP), { label: '  ', text: 'x', whose: 'person' }), /Name the prompt to save it/)
  await assert.rejects(save(at(SHOP), { label: 'x', text: '\n', whose: 'person' }), /Write the prompt it loads into the box/)
  await assert.rejects(save(at(SHOP), { label: 'x'.repeat(LIMITS.label + 1), text: 'x', whose: 'person' }), /at most 80 characters/)
  await assert.rejects(save(at(SHOP), { label: 'x', text: 'x'.repeat(LIMITS.text + 1), whose: 'person' }), /at most 20000 characters/)
  await assert.rejects(save(at(undefined), { label: 'x', text: 'y', whose: 'project' }), /A session with no project has no project's prompts/)
  await assert.rejects(save(at(SHOP), { label: 'x', text: 'y', whose: 'team' } as unknown as Parameters<typeof save>[1]), /yours or the project's/)
  await assert.rejects(save(at(SHOP), { label: 7, text: 'y', whose: 'person' } as unknown as Parameters<typeof save>[1]), /Name the prompt to save it/)
  assert.deepEqual(await prompts(at(SHOP), {}), { person: [], project: [] })
  for (let i = 0; i < LIMITS.count; i++) await save(at(SHOP), { label: `p${i}`, text: 'y', whose: 'project' })
  await assert.rejects(save(at(SHOP), { label: 'one more', text: 'y', whose: 'project' }), /This project has 30 saved prompts: delete one to save another/)
  assert.equal((await prompts(at(DOCS), {})).person.length, 0, "a project's prompts take no room from the person's")
})

test('a list as saved is read strictly: a prompt with no id, name or text is left out, names and texts are cut to their limits, an id is kept once (#2394)', () => {
  assert.equal(savedPromptsFrom({}), undefined)
  assert.deepEqual(
    savedPromptsFrom([
      { id: 'a', label: ' Keep ', text: ' body ' },
      { id: 'a', label: 'Twice', text: 'again' },
      { id: '', label: 'No id', text: 'x' },
      { id: 'b', label: '   ', text: 'x' },
      { id: 'c', label: 'No text', text: 7 },
      null,
      'junk',
      { id: 'd', label: 'L'.repeat(LIMITS.label + 5), text: 'T'.repeat(LIMITS.text + 5) },
    ]),
    [
      { id: 'a', label: 'Keep', text: 'body' },
      { id: 'd', label: 'L'.repeat(LIMITS.label), text: 'T'.repeat(LIMITS.text) },
    ],
  )
  assert.equal(savedPromptsFrom(Array.from({ length: LIMITS.count + 3 }, (_, i) => ({ id: `p${i}`, label: 'l', text: 't' })))!.length, LIMITS.count)
})
