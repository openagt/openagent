export { BRANCHES_DIR, DATA_BRANCH, OPENAGENT_DIR, SKILLS_ENV } from './names.js'
export { installProject, nodeInstallFs, FIRST_COMMIT_MESSAGE, type InstallResult, type InstallDeps, type InstallFs } from './install.js'
export { gitignorePath, openagentGitignore } from './openagent-gitignore.js'
export {
  type GitRunner,
  GitTimeoutError,
  isGitTimeout,
  nodeGitRunner,
  isGitRepo,
  checkoutRoot,
  originDefaultBranch,
  gitReason,
  pushBranch,
} from './git.js'
export { excludeFromGit, unexcludeFromGit, repositoryCheckouts, type ExcludeFs } from './git-exclude.js'
export { removeOwnDirectory, type KeptEntry, type OwnDirectoryRemoval } from './own-directory.js'
export {
  fileBranchPath,
  fileBranchRepo,
  ensureFileBranch,
  removeFileBranch,
  withFileBranch,
  pullFileBranch,
  readBranchFile,
  listBranchDir,
  openBranchReader,
  writeFileBranchDetached,
  nodeBranchFileFs,
  SHARE_SETTING,
  readSharing,
  writeSharing,
  clearSharing,
  branchReach,
  type BranchReach,
  type FileBranchDeps,
  type FileBranchWrite,
  type FileBranchRemoval,
  type FileBranchSync,
  type CommitMessage,
  type DetachedWrite,
  type BranchFileFs,
  type BranchReader,
} from './file-branch.js'
export {
  projectPackages,
  packageBins,
  readManifest,
  declaring,
  lookupProvidedCommand,
  readProvidedCommand,
  runPackageCommand,
  type PackageManifest,
  type ProjectPackage,
  type ProvidedCommand,
  type ProvidedCommandLookup,
  type PackageCommandResult,
} from './provided-command.js'
