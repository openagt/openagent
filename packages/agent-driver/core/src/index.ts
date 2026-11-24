export { toolQuestion } from './question.js'
export { appendInbox, takeInbox, promptOf, promptLines, steeredWords, finishTurn } from './inbox.js'
export { attachLog, logCardFile, logDiaryFile, logLiveFile, agentEnv, DIARY_ENV } from './session-log.js'
export { checkCliReady, probeCli, type CliProbe, type CliSpec, type DriverReadyOptions } from './ready.js'
export { FakeDriver, FakeDriverSession, type FakeTurn, type FakeDriverOptions } from './fake.js'
// What an adapter package builds its driver with: the event stream, the framing and stop
// signals, and reading a file back (the log and the end of a turn are exported above).
export { makeEmit, promptSent, startEvent, type PromptExtras, combineFraming, combineSignals, readWorkspaceFile, oneLine, cutOutput, callArgument, lineCount, patchSize, hunkLines, OUTPUT_MAX } from './session-support.js'
export { ConversationGoneError, continuingTurn } from './gone.js'
export { readyPrompt } from './ready-prompt.js'
// The run's record (#2394, decision 15): its card and its diary, how they read and are written.
export {
  RUNS_DIR,
  ANONYMOUS_DIR,
  isRunId,
  runCardFile,
  runDiaryFile,
  runIdOfFile,
  startOfId,
  personDir,
  parseRunCard,
  formatRunCard,
  parseDiary,
  formatDiary,
  isDiaryLine,
  agentLines,
  newestFirst,
  publicCard,
  type RunCard,
  type ListedRun,
  type RunPatch,
  type RunStatus,
  type DiaryLine,
  type AnyDiaryLine,
} from './record.js'
export { runIdsOf, runEntries, findEntry, readCard, readRunDiary, type RecordsReader, type RunEntry } from './records.js'
export { listRuns, keptRuns, findRun, runFiles, readDiary, writeRun, patchRun, deleteRun, runsPath, recordFunnel, resolveRecordDeps, type RecordDeps, type RecordFiles, type RecordFunnel } from './record-store.js'
export { accountTurn } from './accounts/turn.js'
export { configFile, writePrivate } from './private-files.js'
// The images a person's messages go with, kept on this computer only.
export { imagesDir, isImageName, imageFile, imageMediaType, readImage, hasImage, keepImage, IMAGE_MAX_BYTES, type ImageMediaType } from './images.js'
// The coding agents of the distribution (`run.agent`, #2394): the one a run is on, and the accounts each has.
export { codingAgent, codingAgents, agentNames, UnknownAgent } from './agents.js'
export {
  runCliSession,
  AgentExitError,
  type AgentCliParser,
  type CliIo,
  type RunCliSessionOptions,
  type SpawnLike,
  type SpawnedProcess,
} from './cli-session.js'

// The run engine (#2394): a run from start to end over the distribution's `run.step`s, this
// computer as its host, and what the scheduler, the hosts beside this computer and the dashboard
// share of it: the run's mark and record, its lock, its name.
export { markerCard, writeMarker, withdrawMarker, recordRun, runnerMark, isPublish, PUBLISH_LEVELS, type Publish, type RunnerMark } from './engine/records.js'
export { runIdFrom, projectOf } from './engine/run.js'
export { sweep, type SweepDeps, type SweepResult } from './engine/sweep.js'
export { readyToRun, spawnRun, spawnResume, driverFor, type SpawnedRun, type SpawnedResume } from './engine/runner.js'
export { acquireRunLock, isPidAlive, lockHolder, releaseRunLock, runLockPath, runStderrPath } from './engine/run-lock.js'
export { gitHostEnv } from './engine/git-host.js'
export { INBOX_FILE } from './engine/live-card.js'
export { localHost, type LocalHostDeps } from './engine/host.js'
export { ReadyNaming, type ReadyNamingDeps } from './engine/ready-naming.js'
export { forgetStartedNames, nameStarted, startedName, withStartedNames } from './engine/started-names.js'
// The models a coding agent offers, as its adapter asks it once per account.
export { modelsAskedOnce, firstAccountOf, modelsOf, type AgentModels, type ModelsAsked } from './models.js'
export { NAME_FILE_ENV, givenName, nameHandOver } from './engine/title.js'
// The coding agents' accounts and their rotation (#2394): the lists, the order runs take them in,
// the limits, and the next free one taking over a turn at a usage limit.
export {
  accountsPath,
  hasAddedAccount,
  readAccounts,
  changeAccounts,
  addAccount,
  removeAccount,
  nameOwnAccount,
  useFirst,
  isLimited,
  usableAccounts,
  pickAccount,
  markLimited,
  noteWindows,
  freesIn,
  OWN_NAME,
} from './accounts/accounts.js'
export { accountRotation, goOn, UsageLimitError, type AccountsOption } from './accounts/rotation.js'
export { removeAdded } from './accounts/login.js'
export { loginWiring, type LoginWiring } from './accounts/wiring.js'
export { summaryOf, standing, runEvents, inFolder, type SummaryAt } from './reads/run-reads.js'
export { fromDiaryLine, eventsOf } from './reads/run-events.js'
