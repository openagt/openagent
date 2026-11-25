import type { AgentCalls } from '@openagt/hooks'

/**
 * How Codex's tool calls read in the chat (`RunAgent.calls`): its `action` events are labelled by
 * the kind of the item (commandExecution, fileChange), and a change names every file it made,
 * joined by `, `. An item of another kind (`imageView`) is said by its kind, as words.
 */
export const CODEX_CALLS: AgentCalls = {
  tools: {
    commandExecution: { verb: 'Ran', doing: 'Running', kind: 'command' },
    fileChange: { verb: 'Edited', doing: 'Editing', kind: 'edit', detail: 'path' },
    mcpToolCall: { verb: 'Called', doing: 'Calling', kind: 'other' },
    webSearch: { verb: 'Searched the web', doing: 'Searching the web', kind: 'web', detail: 'query' },
  },
}
