import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FOUND_MAX, TRY_TIMEOUT_MS } from './names.js'
import { checkFound, eachItems, FOUND_OPENING, isDue, lastRunValue, resumeText, RESUMED_OPENING, RESUMED_OPENING_OWN, runCheck, tryCheck } from './check.js'

test('a check reads the time it is given as $LAST_RUN, run through the shell at the repository root', async () => {
  const printed = await runCheck(process.cwd(), 'printf "%s|%s|%s" "$LAST_RUN" "$(basename "$PWD")" "$HOME"', 10_000, '2026-10-09T10:00:00Z')
  // The rest of the environment comes along: a check needs its PATH, its HOME and its logins.
  assert.deepEqual(printed, { ok: true, stdout: `2026-10-09T10:00:00Z|${process.cwd().split('/').at(-1)}|${process.env['HOME']}`, stderr: '' })
  // One that runs out of its time says so, whatever it had printed; one that fails says its own error.
  assert.deepEqual(await runCheck(process.cwd(), 'echo half; echo oops >&2; sleep 5', 300, 'x'), { ok: false, stdout: 'half\n', stderr: 'it took longer than 0.3 seconds' })
  assert.deepEqual(await runCheck(process.cwd(), 'echo oops >&2; exit 3', 10_000, 'x'), { ok: false, stdout: '', stderr: 'oops\n' })
})

/** The time the check was given, which a cut output names. */
const SINCE = '2026-10-09T10:00:00Z'

test('what a run is handed of its check: the opening words, then what the check printed without its outer blank lines and without NUL characters', () => {
  assert.equal(checkFound('\n[{"number": 12}]\n', SINCE), `${FOUND_OPENING}\n[{"number": 12}]`)
  assert.equal(FOUND_OPENING, 'The scheduler starts this command when its check prints something, and this time the check printed what is below. It says why this run started; what the work is, the command says.')
  assert.equal(checkFound('a.md\0b.md\0', SINCE), `${FOUND_OPENING}\na.mdb.md`, 'a command-line argument can hold no NUL')
})

test('a long output is cut at the end of the last whole line that fits, mid-line when its first line alone is too long, and a last line says how much was printed', () => {
  assert.equal(checkFound('y'.repeat(FOUND_MAX), SINCE), `${FOUND_OPENING}\n${'y'.repeat(FOUND_MAX)}`, 'exactly the limit is whole')
  const oneLine = 'x'.repeat(FOUND_MAX + 500)
  assert.equal(checkFound(oneLine, SINCE), `${FOUND_OPENING}\n${'x'.repeat(FOUND_MAX)}\n(cut: the check printed ${FOUND_MAX + 500} characters, these are the first ${FOUND_MAX}; it asked what is new since ${SINCE})`)
  // Lines of eleven characters with their line end: the limit falls inside line 727, which is left out whole.
  const lines = Array.from({ length: 1000 }, (_, i) => `"t-${String(i).padStart(5, '0')}",`).join('\n')
  const handed = checkFound(lines, SINCE).split('\n')
  assert.equal(handed[0], FOUND_OPENING)
  assert.equal(handed.at(-2), '"t-00726",', 'the last line shown is a whole one')
  assert.equal(handed.at(-1), `(cut: the check printed ${lines.length} characters, these are the first 7996; it asked what is new since ${SINCE})`)
  // A line that ends exactly at the limit is whole, and is kept.
  const exact = `${'a'.repeat(3999)}\n${'b'.repeat(4000)}\n${'c'.repeat(50)}`
  assert.equal(checkFound(exact, SINCE), `${FOUND_OPENING}\n${'a'.repeat(3999)}\n${'b'.repeat(4000)}\n(cut: the check printed 8051 characters, these are the first ${FOUND_MAX}; it asked what is new since ${SINCE})`)
})

test('the time a check is given: UTC to the whole second, the fraction dropped and never rounded up', () => {
  assert.equal(lastRunValue('2026-10-09T10:00:00.000Z'), '2026-10-09T10:00:00Z')
  assert.equal(lastRunValue('2026-10-09T10:00:00.999Z'), '2026-10-09T10:00:00Z', 'a thing of that same second is found twice rather than never')
  assert.equal(lastRunValue('2026-10-09T13:00:00+03:00'), '2026-10-09T10:00:00Z')
})

test('due is a check whose JSON is not empty; a non-JSON answer is due by its text', () => {
  assert.equal(isDue('["- [x](tickets/a.md)"]'), true)
  assert.equal(isDue('[]'), false)
  assert.equal(isDue('{}'), false)
  assert.equal(isDue('{"open": 1}'), true)
  assert.equal(isDue('null'), false)
  assert.equal(isDue('false'), false)
  assert.equal(isDue('true'), true)
  assert.equal(isDue('""'), false)
  assert.equal(isDue(''), false)
  assert.equal(isDue('   \n'), false)
  assert.equal(isDue('three entries'), true)
})

test('the items a row with each printed: each run with its words, a run named twice once with both; each new run with what it is for and its branch, named twice once with both; nothing for no work; why for anything else', () => {
  assert.deepEqual(eachItems('[{"run":"r1","text":" one "},{"run":"r2","text":"two"},{"run":"r1","text":"three"}]\n'), { resumes: [{ run: 'r1', text: 'one\n\nthree' }, { run: 'r2', text: 'two' }], starts: [] })
  assert.deepEqual(eachItems('[{"for":"issue 5","text":"a"},{"for":"pr 6","text":"b","branch":" fix "},{"for":"issue 5","text":"c"},{"run":"r1","text":"d"}]'), {
    resumes: [{ run: 'r1', text: 'd' }],
    starts: [{ for: 'issue 5', text: 'a\n\nc' }, { for: 'pr 6', text: 'b', branch: 'fix' }],
  })
  // The first branch named holds, a later item's for the same thing too.
  assert.deepEqual(eachItems('[{"for":"pr 6","text":"a"},{"for":"pr 6","text":"b","branch":"fix"},{"for":"pr 6","text":"c","branch":"other"}]'), { resumes: [], starts: [{ for: 'pr 6', text: 'a\n\nb\n\nc', branch: 'fix' }] })
  for (const nothing of ['', '[]', 'null']) assert.deepEqual(eachItems(nothing), { resumes: [], starts: [] })
  assert.equal(eachItems('r1'), 'the check printed no JSON')
  assert.equal(eachItems('{"run":"r1","text":"x"}'), 'the check printed no list')
  const odd = 'an item of the list is no { "run": "<id>", "text": "…" } and no { "for": "<what>", "text": "…" }, with "branch" only beside "for"'
  for (const item of ['{"run":"r1","text":""}', '{"run":7,"text":"x"}', '"r1"', '{"text":"x"}', '{"run":"r1","for":"issue 5","text":"x"}', '{"run":"r1","text":"x","branch":"fix"}', '{"for":"issue 5","text":"x","branch":""}']) assert.equal(eachItems(`[${item}]`), odd, item)
})

test("what a resumed run is told: the command, then the opening words and the check's words for it; an automation kept on this machine, its name, its text, then the same; long words are cut as a check's output is", () => {
  assert.equal(resumeText({ name: 'reply' }, 'Someone asked why.', '2026-10-19T10:00:00Z'), `/reply\n\n${RESUMED_OPENING}\nSomeone asked why.`)
  assert.equal(resumeText({ name: 'answer', text: 'Answer in two lines.' }, 'Someone asked why.', '2026-10-19T10:00:00Z'), `answer\n\nAnswer in two lines.\n\n${RESUMED_OPENING_OWN}\nSomeone asked why.`)
  assert.match(resumeText({ name: 'reply' }, 'x'.repeat(FOUND_MAX + 1), '2026-10-19T10:00:00Z'), /\(cut: the check printed 8001 characters, these are the first 8000; it asked what is new since 2026-10-19T10:00:00Z\)$/)
})

test('trying a check runs it once as a tick would, asking what is new since a day ago, and says what it printed and whether an agent would start; a check that fails says its last line', async () => {
  const now = new Date('2026-10-09T10:00:00.400Z')
  const found = await tryCheck(process.cwd(), 'printf \'["since %s"]\' "$LAST_RUN"', now)
  assert.deepEqual(found, { lastRun: '2026-10-08T10:00:00Z', ran: true, due: true, printed: '["since 2026-10-08T10:00:00Z"]' })
  assert.deepEqual(await tryCheck(process.cwd(), 'echo "[]"', now), { lastRun: '2026-10-08T10:00:00Z', ran: true, due: false, printed: '[]' })
  assert.deepEqual(await tryCheck(process.cwd(), 'true', now), { lastRun: '2026-10-08T10:00:00Z', ran: true, due: false, printed: '' })
  const failed = await tryCheck(process.cwd(), 'echo half; echo first >&2; echo "no such thing" >&2; exit 3', now)
  assert.deepEqual(failed, { lastRun: '2026-10-08T10:00:00Z', ran: false, due: false, printed: 'half', error: 'no such thing' })
  // A long output is cut as a run is handed it, and says so.
  const long = await tryCheck(process.cwd(), 'unused', now, async () => ({ ok: true, stdout: 'y'.repeat(FOUND_MAX + 10), stderr: '' }))
  assert.equal(long.printed, `${'y'.repeat(FOUND_MAX)}\n(cut: the check printed ${FOUND_MAX + 10} characters, these are the first ${FOUND_MAX}; it asked what is new since 2026-10-08T10:00:00Z)`)
  // The check is the tick's own runner, with less time: a dashboard waits for the answer and gives up before a tick would.
  const seen: unknown[] = []
  await tryCheck('/repo', 'npx queue', now, async (...args) => (seen.push(args), { ok: true, stdout: '', stderr: '' }))
  assert.deepEqual(seen, [['/repo', 'npx queue', TRY_TIMEOUT_MS, '2026-10-08T10:00:00Z']])
  assert.ok(TRY_TIMEOUT_MS < 30_000, 'under the 30 seconds a dashboard gives a command')
  // A line that outlives its time says so, not the shell's own words; one that reads its input finds none and ends at once.
  const slow = await tryCheck(process.cwd(), 'sleep 5', now, runCheck, 300)
  assert.deepEqual(slow, { lastRun: '2026-10-08T10:00:00Z', ran: false, due: false, printed: '', error: 'it took longer than 0.3 seconds' })
  const reading = Date.now()
  assert.deepEqual(await tryCheck(process.cwd(), 'cat', now, runCheck, 5_000), { lastRun: '2026-10-08T10:00:00Z', ran: true, due: false, printed: '' })
  assert.ok(Date.now() - reading < 3_000, 'it did not wait out its time')
  // A very long last line of error is cut.
  const loud = await tryCheck(process.cwd(), 'unused', now, async () => ({ ok: false, stdout: '', stderr: `first\n${'e'.repeat(2000)}\n` }))
  assert.equal(loud.error, `${'e'.repeat(500)}…`)
})
