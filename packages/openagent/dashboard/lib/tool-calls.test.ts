import { describe, expect, test } from 'vitest'
import { callsWords, toolCall } from './tool-calls.js'

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

describe('callsWords', () => {
  test("a run of calls is counted and no more, as Claude Code on the web counts one", () => {
    // Every step is a command there, whatever it was: an edit and two shell commands read as three.
    expect(callsWords(1)).toBe('Ran a command')
    expect(callsWords(3)).toBe('Ran 3 commands')
    expect(callsWords(12)).toBe('Ran 12 commands')
  })
})
