import type * as impl from '../../src/dashboard-rpc/skills.js'
import { rpc } from '../lib/rpc.js'

// The types the RPCs speak in, straight from the implementations — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard-rpc/skills.js'

// Typed stubs for the `skills` RPCs (#2023): what a project has of the skills, the change the
// "Add skills" screen saves, and the skills sent where agents start from.
export const onProjectSkills = rpc<typeof impl.onProjectSkills>('onProjectSkills')
export const sendChangeSkills = rpc<typeof impl.sendChangeSkills>('sendChangeSkills')
export const sendProjectSkills = rpc<typeof impl.sendProjectSkills>('sendProjectSkills')
