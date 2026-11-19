// `@openagt/hooks`: every contract a module plugs into OpenAgent through, and the loader that
// calls them. A module's Node part default-exports `defineModule({ name, hooks })` from its
// package's `./module` entry; a distribution lists the modules, and `loadDistribution` loads them.
// Its UI part's hooks, the places of the shell they fill, are `@openagt/hooks/ui` (`./ui.ts`).
export { RunOrder, StoreOrder } from './order.js'
export type { ProjectRef } from './project.js'
export {
  PUBLISH_LEVELS,
  type Publish,
  type RunOptions,
  type AgentDriverOptions,
  type GithubOptions,
  type GitBranchesOptions,
  type SkillsOptions,
  type PluginsOptions,
  type RunFacts,
  type GitBranchesFacts,
  type GithubFacts,
  type PullRequest,
  type RunOutcome,
  type RunStatus,
  type RunInput,
  type RunContext,
  type RunStep,
  type RunSkill,
  type SkillArgs,
  type RunSkills,
  type RunAgent,
  type RunEvent,
  type RunRequest,
  type RunRef,
  type RunReadiness,
  type RunSummary,
  type RunHost,
  LOCAL_HOST,
} from './run.js'
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
export type { GitAccess, AccountAccess } from './account.js'
export type { AppContext, AppLifecycle, AttentionFix, AttentionItem, AttentionArgs, AppAttention, Attention } from './app.js'
export { HOOK_NAMES, MODULE_NAME, defineModule, type NodeHooks, type HookName, type PluginInfo, type ModuleDefinition } from './module.js'
export { runPipeline, type OrderedStep, type StepError, type PipelineResult } from './pipeline.js'
export { createHooks, loadModules, loadDistribution, loadHandedDown, DISTRIBUTION_ENV, type DistributionEntry, type DistributionPackage, type DistributionItem, type HandlerError, type HooksOptions, type GivenSkill, type Hooks } from './loader.js'
