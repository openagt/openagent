import type * as impl from '../../src/dashboard-rpc/people.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/people.js'

// The git host's accounts behind a project's commit emails: the pictures a card shows of its people.
export const onGitHostPeople = rpc<typeof impl.onGitHostPeople>('onGitHostPeople')
