import type * as impl from '../../src/dashboard-rpc/logins.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/logins.js'

// What runs log in with: the git hosts the projects are on, the coding agent's CLI, a project's own accounts.
export const onGitHosts = rpc<typeof impl.onGitHosts>('onGitHosts')
export const sendUseGitHostAccount = rpc<typeof impl.sendUseGitHostAccount>('sendUseGitHostAccount')
export const sendForgetGitHostAccount = rpc<typeof impl.sendForgetGitHostAccount>('sendForgetGitHostAccount')
export const sendGitHostLogin = rpc<typeof impl.sendGitHostLogin>('sendGitHostLogin')
export const sendGitHostInstall = rpc<typeof impl.sendGitHostInstall>('sendGitHostInstall')
export const onAgentState = rpc<typeof impl.onAgentState>('onAgentState')
export const sendAgentFix = rpc<typeof impl.sendAgentFix>('sendAgentFix')
export const onProjectAccounts = rpc<typeof impl.onProjectAccounts>('onProjectAccounts')
export const sendProjectAccounts = rpc<typeof impl.sendProjectAccounts>('sendProjectAccounts')
