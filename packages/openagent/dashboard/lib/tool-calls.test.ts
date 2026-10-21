import { describe, expect, test } from 'vitest'
import { callsSummary, summaryWords, toolCall, type ToolCall } from './tool-calls.js'

describe('toolCall', () => {
  test("Claude Code's tools read as a verb and what it was done to", () => {
    expect(toolCall('Bash', 'pnpm test')).toEqual({ verb: 'Ran', doing: 'Running', target: 'pnpm test', detail: 'pnpm test', kind: 'command' })
    expect(toolCall('Read', '/repo/AGENTS.md')).toEqual({ verb: 'Read', doing: 'Reading', target: 'AGENTS.md', detail: '/repo/AGENTS.md', kind: 'read' })
    expect(toolCall('Edit', '/repo/src/app.ts').verb).toBe('Edited')
    expect(toolCall('Write', '/repo/src/new.ts')).toMatchObject({ verb: 'Wrote', target: 'new.ts', kind: 'edit' })
    // What a search looked for is in the verb's grey, as Claude Code on the web says it.
    expect(toolCall('Grep', 'TODO')).toMatchObject({ verb: 'Searched', target: 'TODO', kind: 'search', plain: true })
    expect(toolCall('Glob', '**/*.md')).toMatchObject({ verb: 'Searched', target: '**/*.md', kind: 'find', plain: true })
    expect(toolCall('Skill', 'browser')).toMatchObject({ verb: 'Ran skill', target: '/browser', kind: 'skill' })
  })

  test("Codex's item kinds read the same way", () => {
    expect(toolCall('commandExecution', 'pnpm test')).toEqual({ verb: 'Ran', doing: 'Running', target: 'pnpm test', detail: 'pnpm test', kind: 'command' })
    expect(toolCall('fileChange', '/repo/a.ts, /repo/src/b.ts')).toEqual({ verb: 'Edited', doing: 'Editing', target: 'a.ts, b.ts', detail: '/repo/a.ts, /repo/src/b.ts', kind: 'edit' })
    expect(toolCall('mcpToolCall', 'github.search')).toMatchObject({ verb: 'Called', target: 'github.search' })
    expect(toolCall('webSearch', 'vitest docs')).toMatchObject({ verb: 'Searched the web', kind: 'web' })
  })

  test('a label the map does not know is its own verb: a camel-case kind as words, any other name as it is', () => {
    expect(toolCall('imageView')).toEqual({ verb: 'Image view', doing: 'Image view', kind: 'other' })
    expect(toolCall('run https://example.test/1')).toEqual({ verb: 'run https://example.test/1', doing: 'run https://example.test/1', kind: 'other' })
  })

  test('every verb has its word for a call still going on', () => {
    const doing = (label: string) => toolCall(label).doing
    expect(['Bash', 'Read', 'Edit', 'Write', 'Grep', 'WebSearch', 'WebFetch', 'Skill', 'Task'].map(doing)).toEqual(['Running', 'Reading', 'Editing', 'Writing', 'Searching', 'Searching the web', 'Fetching', 'Running skill', 'Starting agent'])
    expect(['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].map(doing)).toEqual(['Running', 'Editing', 'Calling', 'Searching the web'])
  })

  test("an MCP server's tool reads as Claude Code on the web says a connector's: the server, then the tool", () => {
    expect(toolCall('mcp__github__get_me')).toEqual({ verb: 'Used github:', doing: 'Using github:', target: 'Get me', kind: 'other' })
    expect(toolCall('ToolSearch', 'select:Read')).toMatchObject({ verb: 'Loaded tools', kind: 'other' })
  })

  test('a call that changed files is "Created" or "Updated", as Claude Code on the web says them', () => {
    expect(toolCall('Edit', '/repo/a.md', [{ path: '/repo/a.md', added: 1, removed: 1 }]).verb).toBe('Updated')
    expect(toolCall('Write', '/repo/b.md', [{ path: '/repo/b.md', added: 3, removed: 0, created: true }]).verb).toBe('Created')
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
  const words = (calls: ToolCall[]) => summaryWords(callsSummary(calls))

  test('as Claude Code on the web says them: commands, files read, a search of the code, files found, and a skill or any other step as a tool', () => {
    expect(callsSummary([bash])).toEqual({ parts: [{ words: 'Ran a command' }] })
    // Its three runs, step for step.
    expect(words([bash, bash, toolCall('Grep', 'favicon'), toolCall('ToolSearch'), bash])).toBe('Ran 3 commands, searched code, used a tool')
    expect(words([toolCall('Skill', 'github'), bash])).toBe('Ran a command, used a tool')
    expect(words([toolCall('Read', '/repo/README.md'), toolCall('Read', '/repo/index.html'), toolCall('Grep', 'favicon'), toolCall('Glob', '**/*.md')])).toBe('Read 2 files, searched code, found files')
    // A file read twice is one file; two searches are still "searched code".
    expect(words([toolCall('Read', '/repo/a.ts'), toolCall('Read', '/repo/a.ts'), toolCall('Grep', 'a'), toolCall('Grep', 'b')])).toBe('Read a file, searched code')
    expect(words([bash, toolCall('Skill', 'question'), toolCall('mcp__github__get_me'), toolCall('ToolSearch')])).toBe('Ran a command, used 3 tools')
  })

  test('an edit is said by its file with how much it changed, and is no command', () => {
    const summary = callsSummary([bash, edit('/repo/README.md', 12, 54), bash])
    expect(summary).toEqual({ parts: [{ words: 'Ran 2 commands' }, { words: 'edited', target: 'README.md' }], size: { added: 12, removed: 54 } })
    expect(summaryWords(summary)).toBe('Ran 2 commands, edited README.md')
  })

  test('a file edited twice is one file; several files are said by how many were created and how many edited', () => {
    expect(callsSummary([edit('/repo/a.md', 1, 0), edit('/repo/a.md', 2, 1)])).toEqual({ parts: [{ words: 'Edited', target: 'a.md' }], size: { added: 3, removed: 1 } })
    expect(callsSummary([edit('/repo/a.md', 1, 0), edit('/repo/b.md', 2, 1)])).toEqual({ parts: [{ words: 'Edited 2 files' }], size: { added: 3, removed: 1 } })
    // As Claude Code on the web says a turn that made one file and changed another.
    expect(words([bash, bash, bash, edit('/repo/ABOUT.md', 18, 0, true), edit('/repo/README.md', 51, 43), toolCall('ToolSearch'), toolCall('mcp__github__get_me')])).toBe('Ran 3 commands, created a file, edited a file, used 2 tools')
  })

  test('"created" when the run made the one file it changed', () => {
    expect(callsSummary([bash, edit('/repo/new.md', 10, 0, true)])).toEqual({ parts: [{ words: 'Ran a command' }, { words: 'created', target: 'new.md' }], size: { added: 10, removed: 0 } })
  })

  test('an edit whose files its coding agent did not say is still said, with no size', () => {
    expect(callsSummary([bash, toolCall('Edit', '/repo/x.md')])).toEqual({ parts: [{ words: 'Ran a command' }, { words: 'edited a file' }] })
  })
})
