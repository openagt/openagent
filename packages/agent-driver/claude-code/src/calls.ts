import type { AgentCalls } from '@openagt/hooks'

/**
 * How Claude Code's tool calls read in the chat (`RunAgent.calls`): its `action` events are
 * labelled by the tool's name (Bash, Read, Edit), and a tool of an MCP server by Claude Code's
 * name for it, `mcp__<server>__<tool>`: "Used github: Get me", as Claude Code on the web says a
 * call to its connectors.
 */
export const CLAUDE_CODE_CALLS: AgentCalls = {
  tools: {
    Bash: { verb: 'Ran', doing: 'Running', kind: 'command' },
    Read: { verb: 'Read', doing: 'Reading', kind: 'read', detail: 'path' },
    Edit: { verb: 'Edited', doing: 'Editing', kind: 'edit', detail: 'path' },
    MultiEdit: { verb: 'Edited', doing: 'Editing', kind: 'edit', detail: 'path' },
    NotebookEdit: { verb: 'Edited', doing: 'Editing', kind: 'edit', detail: 'path' },
    Write: { verb: 'Wrote', doing: 'Writing', kind: 'edit', detail: 'path' },
    Grep: { verb: 'Searched', doing: 'Searching', kind: 'search', detail: 'query' },
    Glob: { verb: 'Searched', doing: 'Searching', kind: 'find', detail: 'query' },
    WebSearch: { verb: 'Searched the web', doing: 'Searching the web', kind: 'web', detail: 'query' },
    WebFetch: { verb: 'Fetched', doing: 'Fetching', kind: 'other' },
    // "Ran skill /github", as Claude Code on the web says it.
    Skill: { verb: 'Ran skill', doing: 'Running skill', kind: 'skill', detail: 'slash' },
    Task: { verb: 'Started agent', doing: 'Starting agent', kind: 'other', detail: 'task' },
    Agent: { verb: 'Started agent', doing: 'Starting agent', kind: 'other', detail: 'task' },
    TodoWrite: { verb: 'Updated todos', doing: 'Updating todos', kind: 'other' },
    ToolSearch: { verb: 'Loaded tools', doing: 'Loading tools', kind: 'other' },
  },
  families: [{ pattern: 'mcp__(.+?)__(.+)', verb: 'Used $1:', doing: 'Using $1:', target: '$2', kind: 'other' }],
}
