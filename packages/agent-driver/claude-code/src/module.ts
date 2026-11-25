import { accountRotation, firstAccountOf, inFolder, modelsAskedOnce, type DriverReadyOptions } from '@openagt/agent-driver'
import { defineModule, type RunAgent } from '@openagt/hooks'
import { CLAUDE_CODE_CALLS } from './calls.js'
import { ClaudeCodeDriver, claudeCodeReady } from './claude-code.js'
import { CLAUDE_CODE_LOGO } from './logo.js'
import { claudeLogins } from './logins.js'

/**
 * Claude Code as a coding agent runs are on (`run.agent`, #2394). A run's sessions bypass its
 * permission prompts: the agent works in the run's own checkout, and nobody is there to approve a
 * tool. Its turns take the person's Claude accounts, the list `claude` ({@link claudeLogins}), and
 * its models are asked of it on the one its runs take first. `checks` is how its CLI is asked,
 * swapped in tests.
 */
export function claudeCodeAgent(checks: Pick<DriverReadyOptions, 'probe' | 'isRoot'> = {}): RunAgent {
  const models = modelsAskedOnce(() => new ClaudeCodeDriver({ accounts: accountRotation(claudeLogins()) }).listModels(), () => firstAccountOf('claude'))
  return {
    id: 'claude-code',
    label: 'Claude Code',
    logo: CLAUDE_CODE_LOGO,
    program: { bin: 'claude', npm: '@anthropic-ai/claude-code' },
    ownQuestionTool: true,
    calls: CLAUDE_CODE_CALLS,
    accounts: claudeLogins(),
    models: opts => models.read(opts),
    // Every part of the person's setup has a switch in Claude Code: none is a warning.
    ready: ({ addedAccount }) => claudeCodeReady({ ...checks, addedAccount }),
    driver: ({ env, personal, accounts }) => new ClaudeCodeDriver({ permissionMode: 'bypassPermissions', env, personal, ...(accounts ? { accounts } : {}) }),
    // The CLI finds a session by the folder it ran in, usually gone by then (a run that ends clean
    // has its checkout removed): made again first, empty, which is enough to read the conversation back.
    resumeCommand: ({ id, cwd }) => inFolder(cwd, `claude --resume ${id}`),
  }
}

export default defineModule({ name: 'agent-driver-claude-code', hooks: { 'run.agent': [claudeCodeAgent()] } })
