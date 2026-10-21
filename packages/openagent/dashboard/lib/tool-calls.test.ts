import { describe, expect, test } from 'vitest'
import { callsSummary, summaryWords, toolCall } from './tool-calls.js'

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
  const bash = toolCall('Bash', 'git status')
  const edit = (path: string, added: number, removed: number, created?: true) => toolCall('Edit', path, [{ path, added, removed, ...(created ? { created } : {}) }])

  test('commands are counted, as Claude Code on the web counts them: every step that is no edit is one', () => {
    expect(callsSummary([bash])).toEqual({ words: 'Ran a command' })
    expect(callsSummary([bash, toolCall('Read', '/repo/a.ts'), toolCall('Skill', 'question')])).toEqual({ words: 'Ran 3 commands' })
  })

  test('an edit is said by its file with how much it changed, and is no command', () => {
    const summary = callsSummary([bash, edit('/repo/README.md', 12, 54), bash])
    expect(summary).toEqual({ words: 'Ran 2 commands, edited', target: 'README.md', size: { added: 12, removed: 54 } })
    expect(summaryWords(summary)).toBe('Ran 2 commands, edited README.md')
  })

  test('the same file edited twice is one file with its lines summed; several files are said by how many', () => {
    expect(callsSummary([edit('/repo/a.md', 1, 0), edit('/repo/a.md', 2, 1)])).toEqual({ words: 'Edited', target: 'a.md', size: { added: 3, removed: 1 } })
    expect(callsSummary([edit('/repo/a.md', 1, 0), edit('/repo/b.md', 2, 1)])).toEqual({ words: 'Edited', target: '2 files', size: { added: 3, removed: 1 } })
  })

  test('"created" when the run made every file it changed', () => {
    expect(callsSummary([bash, edit('/repo/new.md', 10, 0, true)])).toEqual({ words: 'Ran a command, created', target: 'new.md', size: { added: 10, removed: 0 } })
  })

  test('an edit whose files its coding agent did not say is still said, with no size', () => {
    expect(callsSummary([bash, toolCall('Edit', '/repo/x.md')])).toEqual({ words: 'Ran a command, edited', target: 'a file' })
  })
})
