---
name: orchestration
description: "Split your task across subagents: plan it, get the person's yes, start other agents on the parts, each in its own checkout on a branch started from yours, and land their work on your branch."
---

# Orchestration

A subagent is another coding agent you start on one part of your task: it works alone, in its own checkout. Use the `orchestration` command, always run by its full name: `npx @openagt/skill-orchestration@0.1`.

```
npx @openagt/skill-orchestration@0.1 plan <file>    save the file as your plan; answers the `tasks` it was read as and the `question` to ask the person
npx @openagt/skill-orchestration@0.1 plan           your saved plan, its tasks, and whether the person approved it
npx @openagt/skill-orchestration@0.1 start --task <id>
                                                    start a subagent on that task of your plan; answers its id at once, without waiting for it
npx @openagt/skill-orchestration@0.1 next           every task of your plan and where it stands, and how many more subagents may run at once
npx @openagt/skill-orchestration@0.1 list           your subagents, newest first, as one JSON array
npx @openagt/skill-orchestration@0.1 read <id>      one subagent: its `status`, and once it ended its `branch` and `result`, its last reply
npx @openagt/skill-orchestration@0.1 stop <id>      stop a subagent that is running
npx @openagt/skill-orchestration@0.1 retry <id> "<what to do differently>"
                                                    another subagent on the task that one did, told what to do differently
npx @openagt/skill-orchestration@0.1 land <id>      merge an ended subagent's branch into yours, run the `Check:` line of the task it did, then delete that branch
```

A refusal exits 1 with a line on stderr saying why.

## When splitting is worth it

A subagent is a whole second agent: its own checkout, its own reading of the project, its own money. Splitting pays when the parts are genuinely independent, each one is big enough to be worth a start, and each can be written without reading the others as they are being written. It costs more than doing the work yourself when the parts are small, when they touch the same files, or when the work is one line of thought carried from one end to the other — then one agent that holds the whole picture is both cheaper and better. A task a person would have to answer a question about is nobody's but yours: a subagent is told that nobody will answer it, so rate such a task above 0 and keep it.

## Plan first

Before any subagent, write your plan to a markdown file outside your checkout, as a task list:

```md
# What the whole plan does

What every task needs to know about the project: where the work is, how it is built,
what not to touch. Written here once, the command puts it in front of every task.

Check: pnpm -w test

## The name of one task

Level: simple
Files: src/a.ts, src/a.test.ts
Needs: another task's name
Check: pnpm test
Uncertainty: 0

What to change, for a reader who knows nothing of your conversation.
```

One `## ` heading per task, and the heading is the task's name: it goes on the record of the subagent that does it and is what a person reads in a list of runs, so name the work. Leave out `Files:`, `Needs:` and `Check:` where a task has none. `Uncertainty:` counts the significant alternatives the task holds, never syntax: 0 when the right way is clear. **Only a task at 0 may be a subagent** — nobody answers a subagent's question — so keep every other task for yourself, and say in the plan which ones those are.

The `Check:` line above the first task is the project's own checks, and `land` runs it once the last task is landed. It is the plan's, not a task's: no subagent is told it. A task's own `Check:` line goes under its heading, and `land` runs that one when that task's work is merged.

Save it with `plan <file>`, which answers the tasks it read, each with the `id` to start it by: read them back against what you wrote. A file it cannot read as a task list is refused and not saved. Then show the plan in your reply and ask the person with this block as the very last thing in it, `<question>` being the `question` the command answered, copied exactly:

```await-choices
{ "title": "<question>", "options": [{ "label": "Approve" }, { "label": "Change the plan" }], "recommended": "Approve" }
```

End your reply there. `start` is refused until the person chose Approve for the plan as it is saved. After any other answer, ask them what to change, unless they said; after any change to the plan, save it and ask again.

## One file set per task

Each task owns the files its `Files:` line lists and touches nothing outside them. Two tasks that write one file are two agents whose work conflicts when the second one lands, and `start` says so on stderr — it does not refuse, since the plan you wrote said to do it. So split the work by file set: give every task a `Files:` line, and when two parts want the same file, make them one task, or give the file to one of them and have the other go through what it writes.

## Start

Commit first: a subagent's branch starts from your branch's last commit. Then `start --task <id>`, one task of the plan at a time. The command writes the subagent's prompt itself, out of the plan — the shared context, the task's own words, the files it owns and its check line — so there is nothing to quote, and the person's settings pick the model from the task's `Level:`. `start` is refused with `limit` while as many of your subagents run as the person allows, and with `needs` for a task whose `Needs:` names a task that is not landed yet: the refusal says of each one whether nobody started it, it is running, or it ended and was not landed, so you know whether to start it, wait for it, or land it.

`next` answers all of that in one go: every task of the plan with its state — `landed`, `running`, `ended` (it ended and was not landed: land it or retry it), `waiting` (it `needs` tasks that are not landed), `yours` (`start` refuses it: it is uncertain, unrated or at no level), `startable` — and `places`, how many more subagents may run at once. Read it instead of keeping the state of your plan in your head.

## Then end your reply

After starting the subagents, end your reply: do not wait, sleep or poll `list`. Each time a subagent ends you get a message, sent by the program that ran it and not by the person, that begins `The run <id>, started for this run, ended <status>`. The status is `done`, `failed`, `stopped`, or `waiting`: it stopped on a question nobody can answer, so treat it as failed. The message gives the subagent's last reply and, when one is left, the branch its work is on. Go on from there: land the work with `land <id>`, start another subagent, or end your reply again while others still run.

## Land, and what it checks

`land <id>` merges that subagent's branch into yours, then runs the `Check:` line of the task it did, in your checkout, on the work as it now stands. The land after which every task of the plan is landed runs the plan's own check too, the project's. A check that fails is a refusal carrying the command, its exit code and what it printed: the merge stays in and the subagent's branch stays alive, so fix it on your branch, commit, and `land <id>` again, which then only runs the check.

Where the work is wrong rather than nearly right, `retry <id> "<what to do differently>"` starts another subagent on the same task, with your sentence added to the task's words. Its branch starts from your branch, like any other subagent's: the failed attempt's commits stay on its own branch for you to read, and the retry's branch is the one to land. A subagent that ended `done` may be retried too — a check failing on `land` is how a `done` subagent turns out to have failed; one that is still running is refused.

## When every task is landed

Say so and end your reply: publish nothing yourself. Your branch becomes one pull request when the person publishes it, or asks you to: then, and only once every task is landed, publish it the way this project publishes work, with the tasks listed in the pull request's body.
