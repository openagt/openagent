import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DEFAULT_FAN_OUT_COUNT, DEFAULT_PRIORITY, PRIORITIES, QUEUE_COMMAND, addArgs, addTextArgs, doneArgs, paceWords, isWorkingOn, entryHeadline, priorityMeaning, addToQueue, alreadyQueued, entryLabel, fanOut, fanOutLabel, queueLine, topEntries, workOnEntryPrompt, type CommandResult } from './module.js'

test('entryLabel shows a leading link\'s text, opens only an absolute http(s) target, and keeps anything else whole', () => {
  assert.deepEqual(entryLabel('[Login page](tickets/2026-08-01_login-page.md) — needs the cookie first'), { text: 'Login page' })
  assert.deepEqual(entryLabel('[Upstream bug](https://github.com/x/y/issues/1)'), { text: 'Upstream bug', url: 'https://github.com/x/y/issues/1' })
  assert.deepEqual(entryLabel('  Tidy the loader  '), { text: 'Tidy the loader' })
  // A link further in is part of a sentence, not the entry's name.
  assert.deepEqual(entryLabel('Read [the spec](README.md) first'), { text: 'Read [the spec](README.md) first' })
})

test('a link is queued as a markdown link in its priority\'s section; plain text stays plain and unranked', () => {
  assert.equal(queueLine({ text: 'Login page', href: 'tickets/2026-08-01_login-page.md' }), '[Login page](tickets/2026-08-01_login-page.md)')
  assert.equal(queueLine({ text: 'Create tickets/2026-08-01_login-page.plan.md' }), 'Create tickets/2026-08-01_login-page.plan.md')
  assert.deepEqual(addArgs({ text: 'Login page', href: 'tickets/2026-08-01_login-page.md', priority: 8 }), ['add', '[Login page](tickets/2026-08-01_login-page.md)', '--priority', '8'])
  assert.deepEqual(addArgs({ text: 'Create tickets/x.plan.md', priority: 0 }), ['add', 'Create tickets/x.plan.md', '--priority', '0'])
  assert.deepEqual(addArgs({ text: 'Tidy the loader' }), ['add', 'Tidy the loader'])
})

/** A queue stub: its entries are `open`, and every `add` is recorded and answers `ok`. */
function queueOf(open: string[], onAdd: (args: string[]) => CommandResult = () => ({ ok: true, output: { ok: true } })) {
  const seen: string[][] = []
  const run = async (args: string[]): Promise<CommandResult> => {
    seen.push(args)
    return onAdd(args)
  }
  return { queue: { entries: async () => open, run }, seen }
}

test('addToQueue reads the open entries once, runs one add per link not yet queued in order, and stops at the first failure or refusal with its reason', async () => {
  const { queue, seen } = queueOf([])
  assert.deepEqual(await addToQueue(queue, [{ text: 'a', href: 'tickets/a.md', priority: 5 }, { text: 'b' }]), { ok: true })
  assert.deepEqual(seen, [['add', '[a](tickets/a.md)', '--priority', '5'], ['add', 'b']])

  const failing = queueOf([], args => (args[1] === 'b' ? { ok: false, error: 'queue took too long' } : { ok: true, output: { ok: true } }))
  assert.deepEqual(await addToQueue(failing.queue, [{ text: 'a' }, { text: 'b' }, { text: 'c' }]), { ok: false, error: 'queue took too long' })
  assert.deepEqual(
    failing.seen.map(args => args[1]),
    ['a', 'b'],
    'the batch stops where it failed',
  )

  const refusing = queueOf([], () => ({ ok: true, output: { ok: false, reason: 'not-a-repo' } }))
  assert.deepEqual(await addToQueue(refusing.queue, [{ text: 'a' }]), { ok: false, error: 'the queue refused: not-a-repo' })
  assert.deepEqual(await addToQueue(queueOf([], () => ({ ok: true, output: { ok: false } })).queue, [{ text: 'a' }]), { ok: false, error: 'the queue refused' })
  // An empty batch reads nothing and is done; a read that cannot run stops the batch before any add.
  const untouched = queueOf([])
  assert.deepEqual(await addToQueue(untouched.queue, []), { ok: true })
  assert.deepEqual(untouched.seen, [])
  const unread = queueOf([])
  assert.deepEqual(await addToQueue({ ...unread.queue, entries: async () => Promise.reject(new Error('no remote')) }, [{ text: 'a' }]), { ok: false, error: 'no remote' })
  assert.deepEqual(unread.seen, [])
})

test('a link already on the queue is left as it is: by its target when it points somewhere, by its exact text otherwise', async () => {
  const open = ['[Login page](tickets/2026-08-01_login-page.md) — needs the cookie first', 'Create tickets/2026-08-02_b.plan.md', '  Tidy the loader  ']
  assert.equal(alreadyQueued(open, { text: 'Login page, retitled', href: 'tickets/2026-08-01_login-page.md' }), true)
  assert.equal(alreadyQueued(open, { text: 'Other', href: 'tickets/2026-08-02_b.md' }), false)
  assert.equal(alreadyQueued(open, { text: 'Create tickets/2026-08-02_b.plan.md' }), true)
  assert.equal(alreadyQueued(open, { text: 'Tidy the loader' }), true)
  assert.equal(alreadyQueued(open, { text: 'Create tickets/2026-08-01_login-page.plan.md' }), false)
  // A plain text is not matched by a link's text: the two are different lines on the queue.
  assert.equal(alreadyQueued(open, { text: 'Login page' }), false)

  const { queue, seen } = queueOf(open)
  assert.deepEqual(
    await addToQueue(queue, [
      { text: 'Login page', href: 'tickets/2026-08-01_login-page.md', priority: 8 },
      { text: 'Other', href: 'tickets/2026-08-02_b.md', priority: 3 },
      { text: 'Create tickets/2026-08-02_b.plan.md' },
      { text: 'Create tickets/2026-08-03_c.plan.md' },
    ]),
    { ok: true },
  )
  assert.deepEqual(seen, [['add', '[Other](tickets/2026-08-02_b.md)', '--priority', '3'], ['add', 'Create tickets/2026-08-03_c.plan.md']])
})

test('the prompt for one entry carries the raw entry line and forbids any other', () => {
  const prompt = workOnEntryPrompt('[Login page](tickets/2026-08-01_login-page.md) — cookie first')
  assert.ok(prompt.endsWith('The entry:\n\n[Login page](tickets/2026-08-01_login-page.md) — cookie first'))
  assert.ok(prompt.includes('Do not start any other entry'))
  assert.ok(prompt.includes('queue done'))
})

test('a fan-out takes the top of the queue, at least one and never more than there are, and its label says how many', () => {
  assert.deepEqual(topEntries(['a', 'b', 'c'], 2), ['a', 'b'])
  assert.deepEqual(topEntries(['a', 'b'], 5), ['a', 'b'])
  assert.deepEqual(topEntries(['a', 'b'], 0), ['a'])
  assert.equal(DEFAULT_FAN_OUT_COUNT, 3)
  assert.equal(fanOutLabel(1), 'Start an agent working on the top entry')
  assert.equal(fanOutLabel(3), 'Start 3 agents working on the top 3 entries')
})

test('fanOut starts one run per entry in order, each on its own entry, and stops at the first refusal with its reason', async () => {
  const prompts: string[] = []
  const ok = await fanOut(async prompt => {
    prompts.push(prompt)
    return { ok: true, agentId: `run-${prompts.length}` }
  }, ['a', 'b'])
  assert.deepEqual(ok, { started: ['run-1', 'run-2'] })
  assert.deepEqual(prompts, [workOnEntryPrompt('a'), workOnEntryPrompt('b')])

  const seen: string[] = []
  const stopped = await fanOut(async prompt => {
    seen.push(prompt)
    return seen.length === 2 ? { ok: false, error: 'the daemon refused' } : { ok: true, agentId: `run-${seen.length}` }
  }, ['a', 'b', 'c'])
  assert.deepEqual(stopped, { started: ['run-1'], error: 'the daemon refused' })
  assert.equal(seen.length, 2, 'the third entry is never tried')
  assert.deepEqual(await fanOut(async () => ({ ok: true, agentId: 'x' }), []), { started: [] })
})

test('the page adds a typed task with `queue add` at the priority picked, trimmed', () => {
  assert.deepEqual(addTextArgs('  Tidy the loader  ', 8), ['add', '--priority', '8', '--', 'Tidy the loader'])
  // A task that opens with a dash is still the task: it comes after `--`, where nothing is a flag.
  assert.deepEqual(addTextArgs('--help', 0), ['add', '--priority', '0', '--', '--help'])
  assert.deepEqual(doneArgs('--help'), ['done', '--', '--help'])
})

test('the priorities run from the most urgent down, the page starts in the middle, and only the two ends have words', () => {
  assert.deepEqual(PRIORITIES, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
  assert.equal(DEFAULT_PRIORITY, 5)
  assert.equal(priorityMeaning(10), 'most urgent')
  assert.equal(priorityMeaning(0), 'only if there is capacity')
  assert.equal(priorityMeaning(5), undefined)
})

test('an agent is on an entry when it was asked exactly what the page asks for that entry', () => {
  assert.equal(QUEUE_COMMAND, 'work-queue')
  assert.equal(isWorkingOn(workOnEntryPrompt('Tidy the loader'), 'Tidy the loader'), true)
  assert.equal(isWorkingOn(workOnEntryPrompt('Tidy the loader'), '  Tidy the loader '), true)
  assert.equal(isWorkingOn(workOnEntryPrompt('Tidy the loader'), 'Fix the login'), false)
  // An entry that is a part of another one, or a word of the prompt itself, is not being worked on.
  assert.equal(isWorkingOn(workOnEntryPrompt('Fix login page layout'), 'Fix login'), false)
  assert.equal(isWorkingOn(workOnEntryPrompt('Fix login page layout'), 'queue'), false)
  // The command that works the queue is asked the command alone: which entry it took is not known here.
  assert.equal(isWorkingOn('/work-queue', 'Tidy the loader'), false)
  assert.equal(isWorkingOn(undefined, 'Tidy the loader'), false)
  // An empty line is in every prompt, and is no entry.
  assert.equal(isWorkingOn('/work-queue', '  '), false)
})

test('entryHeadline names a typed entry by its words up to the first sentence end, colon or dash, the rest under it; a line without one is all name', () => {
  assert.deepEqual(entryHeadline('Fix the checkout rounding. Coupons and gift cards both apply.'), { name: 'Fix the checkout rounding', rest: 'Coupons and gift cards both apply.' })
  assert.deepEqual(entryHeadline('Search: forgive typos in product names'), { name: 'Search', rest: 'forgive typos in product names' })
  assert.deepEqual(entryHeadline('Dark mode — follow the system setting'), { name: 'Dark mode', rest: 'follow the system setting' })
  assert.deepEqual(entryHeadline('Is the cart slow? Measure it first'), { name: 'Is the cart slow', rest: 'Measure it first' })
  // A dot, colon or dash inside a word is part of it.
  assert.deepEqual(entryHeadline('  Bump vite to 7.1 and fix src/app.ts:12 re-renders  '), { name: 'Bump vite to 7.1 and fix src/app.ts:12 re-renders' })
  assert.deepEqual(entryHeadline('Ends with a dot.'), { name: 'Ends with a dot.' })
})

test('the pace a person set for the command that works the queue, in words: whenever there is work, at most every so long, or every so long at a time of day; none for one that does not read', () => {
  const since = '2026-10-03T08:00:00.000Z'
  assert.equal(paceWords({ work: true }), 'whenever there is work')
  assert.equal(paceWords({ every: '6h', since }), 'at most every 6 hours')
  assert.equal(paceWords({ every: '1h', since }), 'at most every hour')
  assert.equal(paceWords({ every: '15m', since }), 'at most every 15 minutes')
  assert.equal(paceWords({ every: '2d', at: '10:00', since }), 'every 2 days at 10:00')
  assert.equal(paceWords({ every: '1mo', since }), 'at most every month')
  assert.equal(paceWords({ every: 'often', since }), undefined)
})
