/** What stands in the way of a run: problems stop it, warnings do not. One line each, each naming its fix. */
export interface StartReadiness {
  problems: string[]
  warnings: string[]
  /**
   * What a press does about a problem: install the coding agent's CLI, or log it in. The command run
   * is the agent's package's, asked again at the press; `problem` is the line of `problems` it answers.
   */
  fix?: { kind: 'install' | 'log-in'; command: string; problem: string }
}

/**
 * A check's answer read as one, or nothing when it is not: a machine's that ran its own. Problems
 * and warnings are lists of lines; a fix answers one of the problems said, or it is no fix to offer.
 */
export function readinessOf(said: unknown): StartReadiness | undefined {
  const fields = (said && typeof said === 'object' ? said : {}) as Record<string, unknown>
  const lines = (value: unknown): string[] | undefined => (Array.isArray(value) && value.every(line => typeof line === 'string') ? value : undefined)
  const problems = lines(fields['problems'])
  const warnings = lines(fields['warnings'])
  if (!problems || !warnings) return undefined
  const fix = (fields['fix'] && typeof fields['fix'] === 'object' ? fields['fix'] : {}) as Record<string, unknown>
  const kind = fix['kind'] === 'install' ? ('install' as const) : fix['kind'] === 'log-in' ? ('log-in' as const) : undefined
  const { command, problem } = fix
  const fixed = kind !== undefined && typeof command === 'string' && typeof problem === 'string' && problems.includes(problem) ? { fix: { kind, command, problem } } : {}
  return { problems, warnings, ...fixed }
}
