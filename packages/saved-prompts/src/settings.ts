import { defineSetting } from '@openagt/hooks'
import { savedPromptsFrom, type SavedPrompt } from './saved.js'

// Where the saved prompts are kept, through the store (#2394): the person's with them, so every
// computer of theirs offers the same; a project's with the project's other data, so it is on the
// project's data branch, and its team's too, where the project keeps its data in its repository.

/** The person's saved prompts, in the order they were saved. */
export const PERSON_PROMPTS = defineSetting<SavedPrompt[]>({ key: 'saved-prompts.person', scope: 'person', default: [], parse: savedPromptsFrom })

/** One project's saved prompts, in the order they were saved. */
export const PROJECT_PROMPTS = defineSetting<SavedPrompt[]>({ key: 'saved-prompts.project', scope: 'project', default: [], parse: savedPromptsFrom })
