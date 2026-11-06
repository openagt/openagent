Issue: [#2309](https://github.com/openagt/openagent/issues/2309)

# Setting up a person on a shared server over Tailscale

## TLDR

Six problems hit while setting up a person on a shared Linux server (0.53.0, owner already installed) reached over Tailscale; the reporter found the same code on `main` (3572798) but did not run it there:

1. **Tailscale door: "Access denied".** `devices tailscale on` as the `openagent` user fails with `sending serve config: Access denied: serve config denied` when that user isn't Tailscale's operator. `sudo tailscale set --operator=openagent` fixes it, but only the "PC on your Tailscale network" setup runs it. Name that command in the door's error (`packages/dashboard-devices/src/door/tailscale.ts:96`, `src/servers/steps.ts:759`).
2. **The door page's pairing command doesn't work on a server.** It says `npx @openagt/dashboard-devices add --qr`, but the device list lives in the `openagent` user's home, so it only works when run as that user. Print a command that works on a server (`src/door/pages.ts:45`).
3. **`devices add` without `--for` pairs into the owner's account.** The person lands seeing the owner's agents and logins. On a server, `devices add` should require a name (`src/door/cli.ts:604`).
4. **No picture at the foot of the sidebar.** After a GitHub login the sidebar still shows an initial; the page gets only the person's name. Proposed: each person gets a name and picture of their own in OpenAgent, with an option to sync them from GitHub, since the agents' GitHub account (often `-agent`) is not the person's (`packages/dashboard/src/dashboard/person.ts:58`).
5. **Sending skills fails after a GitHub login.** `could not read Username for 'https://github.com'`: the dashboard's login never connects git to `gh`. `gh auth setup-git` fixes it but changes the person's own git settings; instead have the dashboard's push use the account's token the way agent runs do (`runEnv`, `packages/skill-github/src/accounts.ts:285`; also `accounts.ts:257`, `dashboard-devices/src/servers/steps.ts:877`, `dashboard/src/dashboard/send-skills.ts:56`).
6. **Sharing records on a public repository publishes the person's email.** Runs land in `agents/<git user.email>/` on `agent-data`, and the share dialog says only that it pushes a branch. Have the dialog warn about it (`packages/skill-logs/src/store.ts:132`, `packages/dashboard/dashboard/components/AddProjectPanel.tsx:243`; the GitHub login's no-reply fallback is `skill-github/src/accounts.ts:232-243`).

## Why it matters

Setting up a second person on a shared server is the path for teams; today it needs undocumented `sudo`, can silently hand a person the owner's account, can't send skills, and can leak an email address publicly.

## Source

Imported from GitHub issue [openagt/openagent#2309](https://github.com/openagt/openagent/issues/2309), opened 2026-11-06 by nitedani, no labels, no comments. Code links in the issue are pinned to commit 3572798. The six items are independent and may be split into separate tickets when planned.
