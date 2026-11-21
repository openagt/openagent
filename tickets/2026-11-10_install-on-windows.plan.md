Effort: 6
Uncertainty: 6

# [Plan] `npx @openagt/install` on Windows

How `packages/install` gains a `windows.ts`, what has to be found out on a real Windows computer first, and what the shared code must stop assuming about POSIX.

## Problems

1. **The dashboard itself on Windows is unchecked** (the ticket's "Comes first"). Already visible in the code: `sh -c` for hook commands and ended-run lines (`dashboard/src/project-hooks.ts:331`, `agent-runner/src/ended.ts:106`, `dashboard/src/dashboard-rpc/logins.ts:282`), process-group kills `process.kill(-pid)` (same files), and `env.HOME` for the registry and the certificate folder (`dashboard/src/registry.ts:335`, `dashboard/src/secure-address.ts:27`): Windows sets `USERPROFILE`, not `HOME`, so both land at `\.openagent…` on the current drive. The install is not worth building before these work.
2. **The shared install code is POSIX-only.** `install.ts` spots an `npx` run by `'/_npx/'` (backslashes on Windows), runs `npm` through `execFile` (on Windows it is `npm.cmd`, which needs a shell), and calls `openssl`, which Windows lacks. `run.ts`'s `asAdmin` is `sudo /bin/sh -c`, and `AdminStep.script` is a shell script; `installed()` looks in `/usr/sbin`. `dashboardVars` falls back to a Unix `PATH`.
3. **Starting at login with no terminal open.** `node.exe` is a console program: started at login it shows a console window unless hidden; its output needs a file (no launchd/journal); and "start again only when it fails" has no direct equivalent.
4. **Trusting the certificate.** Chrome and Edge read the Windows certificate store; Firefox reads it only when `security.enterprise_roots.enabled` is on (believed default on Windows in recent versions: to confirm). Unknown: whether Chrome's verifier on Windows accepts a self-signed `CA:FALSE` leaf as a trust anchor from the store (on Linux it took NSS trust `CP`; on a Mac `trustRoot`).
5. **Port 443 on a loopback address of its own.** All of `127.0.0.0/8` already answers on Windows, so no alias is needed; the redirect to `SECURE_PORT` (4243) is the open part.

## Solutions

- **Admin step** — one UAC prompt: write the step as a PowerShell script to a temp file and run `powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',<script>"`, reading its `ExitCode`. Make `AdminStep` say which shell its script is for (or let each `Platform` run its own admin step: `asAdmin` moves into the platform, which is cleaner than a shell field), so mac/linux keep `sudo /bin/sh -c`.
- **Hosts line** — the same mark (`# OpenAgent`) in `%SystemRoot%\System32\drivers\etc\hosts`, added/removed in PowerShell (read lines, drop the marked one, write back keeping CRLF), then `ipconfig /flushdns`. Defender may flag a hosts change for a well-known name: to check.
- **Port redirect** — `netsh interface portproxy add v4tov4 listenaddress=127.0.0.42 listenport=443 connectaddress=127.0.0.1 connectport=4243`: lasts across restarts by itself, needs the IP Helper service (`iphlpsvc`, on by default). Removed with `netsh interface portproxy delete v4tov4 listenaddress=127.0.0.42 listenport=443`. Alternative if portproxy misbehaves: let the dashboard listen on `127.0.0.42:443` directly (Windows needs no privilege for ports < 1024), which would drop the redirect altogether — but it changes the dashboard's own listening and differs from the other platforms.
- **Certificate** — options, in order of preference:
  1. `openssl` from Git for Windows (`<git>\usr\bin\openssl.exe`, found from `git`'s location): OpenAgent needs git anyway, and `ensureCertificate` stays as is.
  2. PowerShell `New-SelfSignedCertificate` with the same extensions, exported to PEM (`ExportCertificatePem`/`ExportPkcs8PrivateKeyPem` in PowerShell 7 only; Windows PowerShell 5.1 needs manual Base64 of the PFX's parts) — more code, no extra dependency.
  3. A pure-JS X.509 builder (e.g. `@peculiar/x509` or `node-forge`) in `@openagt/install`, which would also remove `openssl` from Linux's `TOOLS` and the Mac — the cleanest long term; weigh it against adding a dependency.
- **Trust** — in the admin step, `certutil -addstore Root <cert>` (LocalMachine: no extra dialog, all browsers on the computer); the uninstall deletes it by its SHA-1 (`certutil -delstore Root <sha1>`). Without admin, `certutil -user -addstore Root` shows Windows' own confirm dialog, like the Mac's. Firefox: if the enterprise-roots pref is not on by default, write it to `<profile>\user.js` per profile (removed by the uninstall), or use `certutil` from NSS — not shipped on Windows, so prefer the pref.
- **Start at login** — a scheduled task `OpenAgent\Dashboard`, trigger at logon of this user, `LogonType=InteractiveToken`, no time limit, restart on failure, registered from XML (`schtasks /Create /XML`) in the admin step (an at-logon trigger needs admin) or with `Register-ScheduledTask` as the person when it allows it (to check). Action: `conhost.exe --headless cmd /c ""<node>" "<bin.js>" >> "<log>" 2>&1"` (no window; Windows 10 21H2+/11), or a `wscript` `.vbs` launcher for older Windows. Variables (`PATH`, `XDG_CONFIG_HOME`): a task inherits the user's environment from the registry, not the install's terminal — set them in the `cmd /c` line. Fallback with no admin: `HKCU\…\CurrentVersion\Run` with the same command (no restart on failure). Stop: `schtasks /End` then kill by the port's owner if the `cmd` wrapper does not pass the end on (to check: `/End` kills only the task's top process).
- **Open the browser** — `openCommand` becomes a function or a `{command, args}` like `dashboard/src/cli/browser.ts:7` (`cmd /c start "" <url>`); reuse that one.

## Considerations

- Windows on ARM and x64 both: nothing above is architecture-specific.
- Paths with spaces (`C:\Users\Jane Doe`) everywhere: the scheduled task XML, the `cmd /c` line, the PowerShell script — quote with functions the tests read, like `quoted`/`unitWord`.
- `linux.ts` already sends WSL users to `npx @openagt/dashboard`; with a Windows install, its message can say "run `npx @openagt/install` from Windows (PowerShell) instead".
- The uninstall must still work when the admin step fails halfway: every remove line tolerates "not there".
- Antivirus/SmartScreen may warn on the hosts change and the portproxy rule: say so in the step's `says`.
- Tests: the pure functions (PowerShell scripts, task XML, the `cmd` line) unit-tested on Linux CI like `mac.test.ts`/`linux.test.ts`; the real run only on a Windows computer (a GitHub Actions `windows-latest` job could run the install end to end: it has admin without UAC).

## Comes first

A ticket of its own, before this one: "The dashboard on Windows without WSL" — run `npx @openagt/dashboard` on Windows, start a run with Claude Code and Codex, let the scheduler start one, and fix what fails (at least `HOME` → `os.homedir()`, `sh -c` → a shell per platform, process-group kills → `taskkill /T /F` or a tree kill). Its findings may change this plan; mark it `Outdated: yes` if so.

## Implementation

1. Shared code, no behaviour change on Mac/Linux:
   - `asAdmin` becomes the platform's (`Platform.asAdmin(step, io)`), `AdminStep.script` stays text in that platform's shell.
   - `lastingDashboard`: detect `_npx` with `sep`-agnostic matching; run `npm` with `shell: true` on Windows (or `process.execPath` + `npm-cli.js`).
   - `openCommand` → `open(url)` on `Platform`, Windows reusing the dashboard's `browser.ts` logic.
   - `dashboardVars`: no Unix `PATH` fallback on Windows (`Path`, case-insensitive).
   - The certificate is made through `Platform.prepare`'s found `openssl` (Git for Windows' on Windows), or a pure-JS builder if chosen.
2. `windows.ts` with pure functions for: the admin install/uninstall PowerShell scripts (hosts line, portproxy, `certutil` Root store, the scheduled task), the task XML, the hidden launch line; and `windows: Platform` running them. `unable`: no PowerShell, or Windows older than 10 21H2 (for `conhost --headless`), or no `git`.
3. `install.ts`: `PLATFORMS.win32 = windows`; the "Mac or Linux only" messages updated in both commands.
4. `windows.test.ts` for the pure functions; a `windows-latest` CI job that installs, fetches `https://openagent.build` with the made certificate, and uninstalls, checking hosts, portproxy, store and task are gone.
5. `packages/install/package.json` description and the website's install instructions name Windows.
