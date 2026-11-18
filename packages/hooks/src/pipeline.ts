import type { RunContext, RunOutcome, RunStep } from './run.js'

/** A step, with the module it comes from. */
export interface OrderedStep extends RunStep {
  readonly module: string
}

/** A step that threw: its module, its name, what it threw. */
export interface StepError {
  module: string
  step: string
  error: unknown
}

/** How a run's pipeline went: the run's outcome, and every step that threw. */
export interface PipelineResult {
  outcome: RunOutcome
  errors: StepError[]
}

/**
 * Run a run's steps, sorted by their order:
 *
 * - The steps before 0 prepare the run, then the steps at 0 are its turns. The first one that
 *   throws fails the run, named in its outcome, and the rest of them are skipped. A stop asked
 *   before one of them starts skips the rest too, and the run is stopped.
 * - The turns set the outcome; one that sets none leaves the run done.
 * - The steps after 0 finish the run, whatever its outcome: each one runs, also after another
 *   threw, so a failed run still gets its record saved and its worktree reclaimed. What they
 *   throw is in `errors`, and does not change the outcome.
 */
export async function runPipeline(steps: readonly OrderedStep[], ctx: RunContext): Promise<PipelineResult> {
  const errors: StepError[] = []
  let ended: RunOutcome | undefined
  for (const step of steps.filter(step => step.order <= 0)) {
    if (ctx.signal.aborted) {
      ended = { status: 'stopped' }
      break
    }
    try {
      await step.run(ctx)
    } catch (error) {
      errors.push({ module: step.module, step: step.name, error })
      ended = { status: 'failed', error: `${step.name}: ${messageOf(error)}` }
      break
    }
  }
  ctx.outcome = ended ?? ctx.outcome ?? { status: 'done' }
  for (const step of steps.filter(step => step.order > 0)) {
    try {
      await step.run(ctx)
    } catch (error) {
      errors.push({ module: step.module, step: step.name, error })
    }
  }
  return { outcome: ctx.outcome, errors }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
