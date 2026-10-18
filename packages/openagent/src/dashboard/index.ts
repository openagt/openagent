export { startDashboard, type Dashboard, type DashboardOptions } from './server.js'
export type { StartAgentOptions, StartAgentResult, AddProjectResult, StartedInResult, StartedProject, RemoveProjectResult, CleanupReport, OnboardingSuggestion, AgentWorktree } from './types.js'
export {
  summarizeProject,
  defaultProjectsProvider,
  type ProjectSummary,
  type ProjectionRead,
  type ProjectsProvider,
  type SummarizeDeps,
} from './projects.js'
export { resolveDashboardBundle } from './bundle.js'
export { makeRpcMount, RPC_PREFIX, isSameOriginRequest, isExpectedHost, type EventsSource } from './rpc-serve.js'
export { serveClientBundle } from './static.js'
export { readDocs, DOC_CATEGORIES, type WorkspaceDoc } from './docs.js'
export { collectQueue, type ProjectQueue } from './queue.js'
export { buildOverview, buildRecentAgents, type Overview, type ActiveAgent as ActiveAgent, type RecentProject, type RecentAgent as RecentAgent, type OverviewDeps } from './overview.js'
export { buildDashboard, type DashboardData, type ProjectStat, type DashboardDeps } from './dashboard.js'
export { readGitStatus, type GitStatus } from './git-status.js'
export { prView, prsForBranch, openPrs, pickAgentPr, type LinkedPr, type OpenPr, type PrLookup, type BranchPrLookup, type PrLister } from './pull-requests.js'
export {
  readAgentHandoff,
  agentBranchFor,
  openAgentPullRequest,
  type AgentHandoff,
  type HandoffCommit,
  type HandoffFile,
  type HandoffResult,
  type AgentHandoffDeps,
} from './agent-handoff.js'
export {
  buildInterventions,
  interventionKey,
  type Intervention,
  type InterventionsDeps,
} from './interventions.js'
export { buildOpenQuestions, type OpenQuestion, type OpenQuestionsDeps } from './open-questions.js'
export { bridgeChoiceRequest, type BridgeOption, type BridgeQuestion } from './bridge-question.js'
export { buildActivity, activityKey, type Activity, type ActivityDeps } from './activity.js'
export { SeenTracker } from './keyed-watcher.js'
export { BRIDGE_PREFIX, handleBridgeRequest, type BridgeHandlers, type BridgeSession, type BridgeEvent, type BridgeHello, type BridgeStart } from './bridge-endpoints.js'
export { bridgeStarts, resetBridgeStarts, BridgeStarts, START_CLAIM_TTL_MS, MAX_START_PROMPT, type BridgeStartRequest, type BridgeStartState, type BridgeStartInput } from './bridge-starts.js'
export { WEB_START_PREFIX, DAEMON_URL_ENV, handleWebStartRequest, type WebStartHandlers } from './web-start-endpoints.js'
export { bridgeSessionsFrom, BRIDGE_SESSION_WINDOW_MS } from './bridge-sessions.js'
export { bridgeQuestions, resetBridgeQuestions, BridgeQuestions, type BridgeContact, type BridgeAnswer } from './bridge-store.js'
