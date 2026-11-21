Topics: [windows, dashboard]

# The dashboard on Windows without WSL

## TLDR

Check that `npx @openagt/dashboard` works on Windows itself (no WSL): start it, start a run with Claude Code and with Codex, let the scheduler start one, and fix what fails. Already visible in the code: `sh -c` for hook commands and ended-run lines (`dashboard/src/project-hooks.ts`, `agent-runner/src/ended.ts`, `dashboard/src/dashboard-rpc/logins.ts`), process-group kills `process.kill(-pid)` in the same files, and `env.HOME` for the registry and the certificate folder (`dashboard/src/registry.ts`, `dashboard/src/secure-address.ts`): Windows sets `USERPROFILE`, not `HOME`.

## Why it matters

`npx @openagt/install` on Windows (`tickets/2026-11-10_install-on-windows.md`) is only worth building on a dashboard that works there; today nobody has checked that it does.

## In the code

- `HOME` → `os.homedir()` wherever the dashboard and the runner build paths from it.
- `sh -c <line>` → a shell per platform (`cmd /d /s /c` or PowerShell on Windows), in one shared helper.
- Process-group kills → `taskkill /T /F /PID <pid>` (or a tree kill) on Windows.
- Look for other POSIX assumptions: `/` in paths matched as strings, `which`, `chmod`, symlinks (skills linked into the working copy: Windows needs junctions or developer mode), `npm` run without a shell (`npm.cmd`).
- A `windows-latest` CI job running the dashboard's tests would keep it working.
