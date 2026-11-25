// `@openagt/hooks`: every contract a module plugs into OpenAgent through, and the loader that
// calls them. A module's Node part default-exports `defineModule({ name, hooks })` from its
// package's `./module` entry; a distribution lists the modules, and `loadDistribution` loads them.
// Its UI part's hooks, the places of the shell they fill, are `@openagt/hooks/ui` (`./ui.ts`), and
// its server part's functions, which the UI part calls, `@openagt/hooks/rpc` (`./rpc.ts`). The
// conventions every module's command keeps are `@openagt/hooks/command` (`./command.ts`), and a
// repository's address, read without git for browser-side code too, `@openagt/hooks/repository-address`.
export { RunOrder, StoreOrder } from './order.js'
export {
  PERSONAL_PARTS,
  isTransientQuotaReason,
  type AccountReading,
  type AccountRotation,
  type AccountTurn,
  type AgentAccount,
  type AgentLogins,
  type Driver,
  type DriverEvent,
  type DriverFix,
  type DriverImplId,
  type DriverModel,
  type DriverPromptOptions,
  type DriverQuota,
  type DriverQuotaUnavailableReason,
  type DriverQuotaWindow,
  type DriverRateLimit,
  type DriverRateWindow,
  type DriverReadiness,
  type DriverSession,
  type DriverStartOptions,
  type DriverTurn,
  type DriverUsage,
  type BackgroundTask,
  type FileChange,
  type InboxLine,
  type LogCard,
  type LogEndStatus,
  type PersonalSetup,
  type PromptLine,
  type Question,
  type QuestionOption,
  type ReadyPrompt,
  type RotatedTurn,
  type RunAgent,
  type RunAgentOptions,
  type RunAgentReadyOptions,
  type SessionLog,
  type SessionLogOptions,
  type SignedIn,
  type SignInSaid,
  type UsageWindow,
  type WrittenCard,
} from './agent.js'
export { saidCall, type AgentCalls, type CallFamily, type CallKind, type CallWords, type SaidCall } from './calls.js'
export { OPENAGENT_DIR, type ProjectRef } from './project.js'
export { sessionsHome } from './sessions-home.js'
export { originUrl, projectNameOf, repositoryAddress, repositorySpelling, type GitRunner } from './origin.js'
export { addressOfRemote, remoteHostOf, spellingOfRemote, typedRepository, type TypedRepository } from './repository-address.js'
export {
  PUBLISH_LEVELS,
  type Publish,
  type RunOptions,
  type AgentDriverOptions,
  type GithubOptions,
  type GitBranchesOptions,
  type SkillsOptions,
  type PluginsOptions,
  type ProfilesOptions,
  type RunFacts,
  type GitBranchesFacts,
  type GithubFacts,
  type PullRequest,
  type PullRequestRead,
  type PullRequestState,
  type RunOutcome,
  type RunStatus,
  type RunInput,
  type RunContext,
  type RunAsking,
  type RunQuestion,
  type RunStep,
  type RunSkill,
  type SkillArgs,
  type RunSkills,
  type RunRequest,
  type RunRef,
  type RunReadiness,
  type RunSummary,
  type RunsWanted,
  type RunHost,
  type RunFound,
  LOCAL_HOST,
} from './run.js'
export type { RunEvent, RunFeedEvent, RunReplayed, RunPartial, ChoiceOption, ChoiceRequest, ChoiceBy } from './run-event.js'
export { answeredQuestion, continuationPrompt, skipPrompt } from './run-event.js'
export { runName } from './run-name.js'
export {
  PERSON,
  COMPUTER,
  projectScope,
  scopeKey,
  chainStore,
  changesOf,
  messageOf,
  isStorePath,
  checkPath,
  isUnder,
  type Scope,
  type Changes,
  type ScopeFiles,
  type Update,
  type Message,
  type ReadOptions,
  type Store,
  type StoreContext,
  type StoreBackend,
} from './store.js'
export { SETTING_SCOPES, SETTINGS_FILE, defineSetting, settingsIn, enabledSetting, type Setting, type SettingScope, type Settings } from './settings.js'
export { PERSON_INFO, isPersonName, isPictureAddress, type PersonInfo, PROFILES, PICKED_PROFILE, PICKED_AGENT, PICKED_GITHUB_ACCOUNT, NAME_RUNS, type AgentPick, DEFAULT_PROFILE, builtInDefault, isProfileId, isProfileName, profileIdOf, profileOf, profilesIn, type Profile, SCHEDULED_COMMANDS, SCHEDULED_COMMANDS_PAGE, type ScheduledCommands, type ScheduledCommandPicks, type SchedulePace, isBranchName, START_FROM, type StartFrom, PROJECTS, type ProjectRecord } from './catalog.js'
export type { GitAccess, AccountAccess, GitAccounts, HostAccounts, HostPerson, RepositoryAccount, RunAccount } from './account.js'
export { ROUTE_PATH, type AppContext, type AppLifecycle, type ProjectsLifecycle, type ProjectRemoval, type ProjectCleanup, type CleanupReport, type GivenFolder, type AppRoute, type AppStart, type AttentionFix, type AttentionMark, type AttentionItem, type AttentionArgs, type WaitingRun, type AppAttention, type Attention, type AttentionRead } from './app.js'
export { HOOK_NAMES, MODULE_NAME, defineModule, type NodeHooks, type HookName, type PluginInfo, type OwnRow, type ModuleDefinition } from './module.js'
export { runPipeline, type OrderedStep, type StepError, type PipelineResult } from './pipeline.js'
export { createHooks, loadModules, loadDistribution, loadHandedDown, distributionItems, packageDirOf, DISTRIBUTION_ENV, type DistributionEntry, type DistributionPackage, type DistributionItem, type HandlerError, type HooksOptions, type GivenSkill, type Hooks } from './loader.js'
