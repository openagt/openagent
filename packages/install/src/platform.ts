/** Where the commands write. */
export interface InstallIO {
  out: (line: string) => void
  err: (line: string) => void
}

/** A step run as the administrator: what it is said to do before the password, and its shell script. */
export interface AdminStep {
  says: string
  script: string
}

/**
 * What the install does its own way on each kind of computer. {@link install} and
 * {@link uninstall} run the same steps everywhere, each through one of these.
 */
export interface Platform {
  /** Why OpenAgent cannot be installed on this computer, or `undefined`. Asked before anything changes. */
  unable(env: NodeJS.ProcessEnv): Promise<string | undefined>
  /** The installed dashboard stopped, when it runs; whether one did. */
  stopDashboard(env: NodeJS.ProcessEnv): Promise<boolean>
  /** The folder of OpenAgent's own the dashboard is installed in, when the command came by `npx`. */
  appDir(env: NodeJS.ProcessEnv): string
  /** Before the certificate is made: the commands the install needs, put on this computer. */
  prepare(io: InstallIO, env: NodeJS.ProcessEnv): Promise<void>
  /** The install's step as the administrator, for the certificate in `certFile`. */
  adminInstall(certFile: string): AdminStep
  /** The browsers made to trust the certificate in `certFile`. */
  trust(certFile: string, io: InstallIO, env: NodeJS.ProcessEnv): Promise<void>
  /** The dashboard started now and at each login, from `node` and its `dashboard` file, with `vars`; says where its output is read. */
  startDashboard(opts: { node: string; dashboard: string; vars: { [name: string]: string } }, env: NodeJS.ProcessEnv): Promise<string>
  /** The command that opens an address in the person's browser. */
  openCommand: string
  /** The dashboard stopped, and no more started at login. */
  removeDashboard(env: NodeJS.ProcessEnv): Promise<void>
  /** The browsers made to stop trusting the certificate in `certFile`. */
  untrust(certFile: string, io: InstallIO, env: NodeJS.ProcessEnv): Promise<void>
  /** The uninstall's step as the administrator: everything {@link adminInstall} put there, taken off. */
  adminUninstall(): AdminStep
  /** The folders the install made, beside the certificate's. */
  folders(env: NodeJS.ProcessEnv): string[]
  /** What the uninstall leaves on purpose, said once it is done; read before {@link folders} are removed. */
  leftBehind(env: NodeJS.ProcessEnv): Promise<string | undefined>
}
