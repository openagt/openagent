import type * as impl from '../../src/dashboard-rpc/skill-choices.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/skill-choices.js'

// The skills a session can pick under the message box: every run's, the others carried, and the project's own.
export const onSkillChoices = rpc<typeof impl.onSkillChoices>('onSkillChoices')
export const onProjectSkillNames = rpc<typeof impl.onProjectSkillNames>('onProjectSkillNames')
