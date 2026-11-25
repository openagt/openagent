import type { RunOptions } from '@openagt/hooks'

/**
 * What the launcher said about a run it just started, for its page until the run's record says it:
 * the record comes seconds later, and the row above the box would change under the person's eyes.
 */
export interface StartPicks {
  /** What the modules' controls picked for the run (`composer.control`). */
  options?: RunOptions
  publish?: string
  repos?: { name: string; from: string }[]
  /** The images the prompt went with, by the names the dashboard kept them under. */
  images?: string[]
}
