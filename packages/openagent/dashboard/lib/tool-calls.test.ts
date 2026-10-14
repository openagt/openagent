import { describe, expect, test } from 'vitest'
import { callsSummary, summaryWords, toolCall } from './tool-calls.js'

/** A run's line as the chat reads it. */
const line = (calls: Parameters<typeof callsSummary>[0]): string => summaryWords(callsSummary(calls))

describe('toolCall', () => {
  test("Claude Code's tools read as a verb and what it was done to", () => {
    expect(toolCall('Bash', 'pnpm test')).toEqual({ verb: 'Ran', doing: 'Running', target: 'pnpm test', detail: 'pnpm test', kind: 'command' })
    expect(toolCall('Read', '/repo/AGENTS.md')).toEqual({ verb: 'Read', doing: 'Reading', target: 'AGENTS.md', detail: '/repo/AGENTS.md', kind: 'read' })
    expect(toolCall('Edit', '/repo/src/app.ts').verb).toBe('Edited')
    expect(toolCall('Write', '/repo/src/new.ts')).toMatchObject({ verb: 'Wrote', target: 'new.ts', kind: 'edit' })
    expect(toolCall('Grep', 'TODO')).toMatchObject({ verb: 'Searched', target: 'TODO', kind: 'search' })
    expect(toolCall('Skill', 'browser')).toMatchObject({ verb: 'Used skill', target: 'browser', kind: 'skill' })
  })

  test("Codex's item kinds read the same way", () => {
    expect(toolCall('commandExecution', 'pnpm test')).toEqual({ verb: 'Ran', doing: 'Running', target: 'pnpm test', detail: 'pnpm test', kind: 'command' })
    expect(toolCall('fileChange', '/repo/a.ts, /repo/src/b.ts')).toEqual({ verb: 'Edited', doing: 'Editing', target: 'a.ts, b.ts', detail: '/repo/a.ts, /repo/src/b.ts', kind: 'edit' })
    expect(toolCall('mcpToolCall', 'github.search')).toMatchObject({ verb: 'Called', target: 'github.search' })
    expect(toolCall('webSearch', 'vitest docs')).toMatchObject({ verb: 'Searched the web', kind: 'search' })
  })

  test('a label the map does not know is its own verb: a camel-case kind as words, any other name as it is', () => {
    expect(toolCall('imageView')).toEqual({ verb: 'Image view', doing: 'Image view', kind: 'other' })
    expect(toolCall('mcp__github__search', 'q')).toMatchObject({ verb: 'mcp__github__search', target: 'q' })
    expect(toolCall('run https://example.test/1')).toEqual({ verb: 'run https://example.test/1', doing: 'run https://example.test/1', kind: 'other' })
  })

  test('every verb has its word for a call still going on', () => {
    const doing = (label: string) => toolCall(label).doing
    expect(['Bash', 'Read', 'Edit', 'Write', 'Grep', 'WebSearch', 'WebFetch', 'Skill', 'Task'].map(doing)).toEqual(['Running', 'Reading', 'Editing', 'Writing', 'Searching', 'Searching the web', 'Fetching', 'Using skill', 'Starting agent'])
    expect(['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].map(doing)).toEqual(['Running', 'Editing', 'Calling', 'Searching the web'])
  })

  test('a call with no detail has no target', () => {
    expect(toolCall('TodoWrite')).toEqual({ verb: 'Updated todos', doing: 'Updating todos', kind: 'other' })
  })

  test('a path that ends in a slash keeps its last part', () => {
    expect(toolCall('Read', '/repo/src/').target).toBe('src')
  })
})

describe('callsSummary', () => {
  test('one kind is counted, singular and plural', () => {
    expect(line([toolCall('Bash', 'a')])).toBe('Ran a command')
    expect(line([toolCall('Bash', 'a'), toolCall('commandExecution', 'b')])).toBe('Ran 2 commands')
  })

  test('several kinds are counted in the order they first came', () => {
    const calls = [toolCall('Read', '/a'), toolCall('Bash', 'x'), toolCall('Read', '/b'), toolCall('Edit', '/a'), toolCall('Grep', 'x'), toolCall('WebFetch', 'https://x.dev')]
    expect(line(calls)).toBe('Read 2 files, ran a command, edited a file, searched once, used a tool')
  })

  test('a lone skill is said by its name, several are counted', () => {
    expect(line([toolCall('Bash', 'x'), toolCall('Skill', 'branches')])).toBe('Ran a command, used skill branches')
    expect(line([toolCall('Skill', 'branches'), toolCall('Skill', 'github')])).toBe('Used 2 skills')
  })
})

// What an edit did to its file, when its coding agent said it (`changed` on the call's output).
describe('a call whose files are known', () => {
  const made = { path: '/ws/docs/DESCRIPTION.md', added: 11, removed: 0, created: true as const }
  const edited = { path: '/ws/src/app.ts', added: 2, removed: 1 }

  test('it names its file and says its size; "Created" when it made the file, "Edited" otherwise, whatever the tool is called', () => {
    expect(toolCall('Write', made.path, [made])).toMatchObject({ verb: 'Created', target: 'DESCRIPTION.md', kind: 'edit', size: { added: 11, removed: 0 } })
    expect(toolCall('Write', edited.path, [edited])).toMatchObject({ verb: 'Edited', target: 'app.ts', size: { added: 2, removed: 1 } })
    expect(toolCall('Edit', edited.path, [edited])).toMatchObject({ verb: 'Edited', target: 'app.ts', size: { added: 2, removed: 1 } })
    // Codex names every file of one change: each by its name, the sizes summed.
    expect(toolCall('fileChange', `${made.path}, ${edited.path}`, [made, edited])).toMatchObject({ verb: 'Edited', target: 'DESCRIPTION.md, app.ts', size: { added: 13, removed: 1 } })
    expect(toolCall('fileChange', made.path, [made, { ...made, path: '/ws/b.md', added: 1 }]).verb).toBe('Created')
  })

  test('a call that changed no file, or whose files are not known, reads as before, with no size', () => {
    expect(toolCall('Edit', edited.path, [])).toEqual(toolCall('Edit', edited.path))
    expect(toolCall('Edit', edited.path).size).toBeUndefined()
  })

  test('a run that changed one file names it, with its size, among the kinds in the order they came', () => {
    expect(line([toolCall('Bash', 'a'), toolCall('Bash', 'b'), toolCall('Bash', 'c'), toolCall('Write', made.path, [made])])).toBe('Ran 3 commands, created DESCRIPTION.md +11 −0')
    expect(line([toolCall('Edit', edited.path, [edited]), toolCall('Bash', 'a')])).toBe('Edited app.ts +2 −1, ran a command')
  })

  test('a file edited by several calls of the run is one file: a new file reads its lines at the end', () => {
    const again = { path: made.path, added: 2, removed: 1 }
    expect(line([toolCall('Write', made.path, [made]), toolCall('Edit', made.path, [again])])).toBe('Created DESCRIPTION.md +12 −0')
    expect(line([toolCall('Edit', edited.path, [edited]), toolCall('Edit', edited.path, [edited])])).toBe('Edited app.ts +4 −2')
  })

  test('several files are counted, with their lines over the run: "created" only when the run made every one', () => {
    expect(line([toolCall('Write', made.path, [made]), toolCall('Edit', edited.path, [edited])])).toBe('Edited 2 files +13 −1')
    expect(line([toolCall('Write', made.path, [made]), toolCall('Write', '/ws/b.md', [{ ...made, path: '/ws/b.md', added: 1 }])])).toBe('Created 2 files +12 −0')
  })

  test('edits whose files are not known are counted as calls, beside the ones that are', () => {
    expect(line([toolCall('Edit', '/ws/old.ts'), toolCall('Edit', '/ws/older.ts')])).toBe('Edited 2 files')
    expect(line([toolCall('Edit', edited.path, [edited]), toolCall('Edit', '/ws/old.ts')])).toBe('Edited app.ts +2 −1, edited a file')
  })

  test('the parts keep the size apart from the words, for the chat to draw it in its colors', () => {
    expect(callsSummary([toolCall('Bash', 'a'), toolCall('Write', made.path, [made])])).toEqual([{ text: 'Ran a command' }, { text: 'created DESCRIPTION.md', size: { added: 11, removed: 0 } }])
    expect(callsSummary([])).toEqual([])
  })
})
