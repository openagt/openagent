---
name: logs
description: The record of every run agents made on this project — what was asked, where the work went, how it ended, what the agent said — where it lives, how to read it, and when to look back before you work.
---

# Agent logs

Every run an agent made on this project leaves a record on the branch `agent-data`, never on a code branch; your checkout does not contain it. A run is two files under `agents/<who>/`: the card, `<id>.json` — what was asked, the branch, the pull request, how it ended, what it cost — and the diary, `<id>.jsonl` — what the agent said along the way, its result.

Read them with the `logs` command, always run by its full name: `npx @openagt/skill-logs@0.1`. You only read: the program that ran an agent records its run, at its end. The command's `delete` and `patch`, and its `--local` and `--full` flags, are for the dashboard that shows the runs; never use them. A refusal exits 1 with a line on stderr; a wrong command line exits 2 with the usage.

## Read

```
npx @openagt/skill-logs@0.1 [--branch <name>] [--limit N]
                                                    the runs, newest first, as one JSON array of cards — the newest 20
                                                    unless --limit says otherwise; --branch keeps the runs on one branch
npx @openagt/skill-logs@0.1 show <id>               one run: its card, plus `diary`, the lines of what the agent
                                                    said, its result, how it ended, and what it cost
```

## Before you plan or work a ticket, read its earlier runs

A ticket may have been worked before. Claiming it names who claimed it before you: a run's id, shaped like `2026-09-08T18-14-30-111Z`, read with `npx @openagt/skill-logs@0.1 show <id>`, or else a branch, read with `npx @openagt/skill-logs@0.1 --branch <name>`; no run on that branch means no record: read the branch itself. A `stopped` or `failed` run tells you what to avoid: read what its agent said before it ended. A `done` run with a `pr` means the work may already be there: read the pull request before doing it again.

## The card

```json
{
  "id": "2026-09-08T18-14-30-111Z",
  "startedAt": "2026-09-08T18:14:30.651Z",
  "endedAt": "2026-09-08T18:15:40.433Z",
  "status": "done",
  "intent": "what the agent was asked to do",
  "driver": "claude-code",
  "model": "opus",
  "branch": "agent-2026-09-08T18-14-30-111Z",
  "pr": { "number": 1765, "url": "https://example.com/org/repo/pull/1765" },
  "cost": 0.62
}
```

`status` is `running`, `done`, `stopped`, `failed` or `waiting` (ended on a question the agent asked, until it is answered). `cost` is in US dollars. Every field but `id`, `startedAt` and `status` is absent when unknown. The program that wrote the card may keep its own bookkeeping under one more key, `caller`; the command never prints it to you.

## The diary

One JSON object per line. Four kinds are the agent's, in the order they happened:

```
{"kind":"said","text":"…"}                       something the agent said
{"kind":"result","text":"…"}                     the agent's final answer for a turn
{"kind":"cost","usd":0.62}                       what a stretch of the run cost, in US dollars
{"kind":"ended","status":"failed","detail":"…"}  how the run ended; detail when it did not end well
```

Each line may also carry `at`, the time it was written, in the card's format.

Any other kind of line is the writing program's own; `show` leaves it out.
