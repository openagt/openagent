import type * as impl from '../../src/dashboard-rpc/skill-choices.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/skill-choices.js'

// What a session picks under the message box: the plugins on in its project it can go without, and the project's own skills.
export const onSkillChoices = rpc<typeof impl.onSkillChoices>('onSkillChoices')
export const onProjectSkillNames = rpc<typeof impl.onProjectSkillNames>('onProjectSkillNames')
