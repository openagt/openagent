Effort: 6
Uncertainty: 5

# [Plan] A comment on an agent's pull request resumes that agent

How a new comment on a pull request a run opened reaches that run instead of a new agent: the parts, the picks made for the ticket's open questions, and the order of the work.

## What is there already

- A run's record keeps its pull request (`pr` on the card, `packages/skill-logs/src/run.ts:39`), its host (`runnerMark(card).host`) and its coding agent's session (`caller.sessionId`).
- `agent-runner run --resume <id> <text>` continues an ended run in its session (`packages/agent-runner/src/run.ts:327`); a run still recorded running is refused.
- `tellParent` (`packages/agent-runner/src/parent.ts:63`) already hands one line to a run the right way either way: into its inbox while it works, as a resume once it has ended, with the race between the two closed. Only children use it today.
- The scheduler only starts new runs: a row's check prints JSON, and `decide` (`packages/agent-scheduler/src/tick.ts`) marks and spawns one run handed that output. Rows come from skills' `schedule` front matter; the tool names no skill.
- `#2138` settled that a run another computer started is only read here: continued here it would have none of its conversation.

## Picks for the open questions

1. **Whose comments count**: those whose `author_association` is `OWNER`, `MEMBER` or `COLLABORATOR` (GitHub puts it on every comment, no extra call), not a bot's (`user.type == "Bot"`), and never one an agent posted. Agents post under the person's own login, so the author cannot tell them apart: an agent's comment carries a hidden line `<!-- openagent-run: <id> -->`, and comments with it are skipped. Picked over anyone's (a stranger's comment would spend the person's quota) and over the author alone (the person and their agents share it).
2. **Line review comments and review bodies count the same way** as thread comments: same API family, same filter, and they are where most review is said. Failing checks: later, their own ticket.
3. **A pull request with no run behind it**: nothing. The row says it answers agents' pull requests.
4. **Which machine**: only the run's own machine (its record's host) answers comments on its pull request; every other machine's scheduler skips it. That is the only machine that has the conversation, and two machines can never both answer. The fallback (a new agent) is for the run's own machine when the conversation cannot be resumed there (no `sessionId`, or the coding agent says the session is gone). This narrows the ticket's fallback "it ran on another machine": with every machine able to answer, a comment would reach two agents whenever both machines have the row on, which breaks point 4 of the TLDR. A run whose machine never has the row on is not answered; its row says so.

## Design

One new kind of scheduled row: a row whose output names runs to tell, not work for a new run.

- **Row key `tells: runs`** in a skill's `schedule` (`ROW_KEYS`, `packages/agent-scheduler/src/schedule.ts:108`). Its check prints a JSON array of `{ "run": "<id>", "text": "<what to hand it>" }`. For each item the scheduler tells that run, instead of spawning one run for the whole output. The tool still names no skill: the github skill brings the row. Picked over a dedicated command that a scheduled agent runs (an agent started only to start another agent) and over the scheduler calling `gh` itself (the tool would know the git host).
- **Telling a run** is a new `agent-runner tell <id> <text>` command: `tellParent`'s logic made public as `tellRun` (rename; `tellParent` calls it), answered at once; it refuses a run whose host is not this one, and a run that cannot be resumed (no session) with `{ok:false, reason:"no-session"}`. The scheduler's `TickDeps` gets `tell(run, text)`.
- **The fallback**: on `no-session`, the scheduler starts a new run of the row's command as today (marker, cap, quota, publish level, `attached`), handed the comments and the line "The run <id> opened this pull request and cannot be resumed: read its record (`npx @openagt/skill-logs@0.1 show <id>`) and the whole thread first, then work on its branch." Its record then names the same pull request (`skill-logs patch --pr`, done by the run when it pushes to the branch, as `open` answers `existing`), so the next comment resumes it: the check takes the latest run naming a pull request.
- **One agent per pull request**: telling a working run puts the text in its inbox; telling an ended one resumes it under its run lock (`acquireRunLock`), so two ticks never resume it twice. The cap is not asked for a tell (it is no new run); the quota is, like any start, read once per tick.
- **What is new** is read off the run's own record, nothing is stored: a comment counts when it is newer than the run's `endedAt` (a working run: newer than nothing yet handed — the inbox line is the hand-off, and its `endedAt` moves when it ends). `$LAST_RUN` is not used by this row. A comment that lands while a resumed run works and after it read the thread is caught because the resumed agent is told to read the thread again before it ends.

## The github skill's part (`packages/skill-github`)

- `comments` subcommand: for every open pull request of the repository whose head branch is a run's (record `pr` set, latest record per pull request, host this machine, status not running or running with a live process), list issue comments, review comments and review bodies newer than the run's `endedAt`, filtered as in pick 1, and print the `tells: runs` array; `[]` when none. One `gh api` call per pull request kind, only for pull requests that have such a run (most machines have a handful).
- The text handed over: "New comments on your pull request <url>:" then each comment (author, time, file:line for a review comment, body), then "Read the whole thread again first (`gh pr view <n> --comments`, and its review comments), and answer from the thread as it stands. Before you end, read it once more and answer anything new. Post every comment with `npx @openagt/skill-github@0.1 comment`."
- `comment <number> --body <text>` subcommand: posts with the hidden `<!-- openagent-run: $AGENT_ID -->` line appended. `SKILL.md` tells agents to comment through it, never `gh pr comment`.
- `schedule` in `packages/skill-github/SKILL.md` (and the copy under `.claude/skills/github`): `when: npx @openagt/skill-github@0.1 comments`, `tells: runs`, `every: 10m`, `waits-for: when a pull request an agent of this machine opened has a new comment`. The row is off by default like every row; its pace and publish pick are the Automations page's as for any row (the publish level reaches a resume through the record's mark, as today; a fallback run takes the row's pick).

## Scheduler changes (`packages/agent-scheduler`)

- `schedule.ts`: read `tells` (only the value `runs`; anything else makes the schedule unreadable); a `tells` row needs `when`.
- `tick.ts` `decide`: after the check, for a `tells` row, parse the array (an unreadable one is `check printed no runs to tell`), then for each item: `tell`; on `no-session` the existing start path with the fallback text. One decision line per row summing it up: `told r1, r2; started r3 for r4`. `startNow` the same.
- `listed`: carry `tells`, so the Automations page can say the row answers runs ("Answers comments on its agents' pull requests") instead of "starts an agent".
- `DECISIONS.md`: bullets for the picks above once the person confirms them (an AI writes a bullet only for a person's pick).

## Considerations

- The agent's comments under the person's login are the sharpest edge: an agent that posts with `gh` directly, not the new command, would resume itself in a loop. Guard: skip comments whose `created_at` falls between the run's last start and its `endedAt` and whose author is the logged-in user (`gh api user`), as a second filter.
- A pull request merged or closed is not open: no tells. A run deleted from the records: its pull request has no run, nothing.
- The first tick after the row is switched on would hand every comment newer than each run's end; that is the point (comments nobody answered), but bounded to open pull requests.
- Rate limits: three `gh api` calls per open agent pull request per pace; at 10 minutes this is far under GitHub's limit.

## Implementation order

1. `agent-runner`: `tellRun` + `tell` command + tests (working run → inbox; ended → resume; other host / no session refused).
2. `skill-github`: `comment` command, `comments` check with its filter, tests with a fake `gh`; `SKILL.md` text and `schedule`.
3. `agent-scheduler`: `tells` key, `decide` branch, fallback, `listed`; tests in `tick.test.ts` and `schedule.test.ts`.
4. Automations page wording for a `tells` row (`AutomationsPage.tsx`), its test.
