Topics: automations, scheduler, github
Issue: [#2042](https://github.com/openagt/openagent/issues/2042)

# A comment on an agent's pull request resumes that agent

## TLDR

Today a comment on a pull request an agent opened starts a new agent, which knows nothing of the first one's conversation. Instead the run that opened the pull request is resumed, on the coding agent and model it ran on, and answers. It also fixes red checks and merge conflicts.

1. **Resume rows in the scheduler.** A row may say it resumes; its check prints which runs to continue, with the words for each (`[{ "run": "<id>", "text": "…" }]`), and the scheduler resumes each instead of starting a new run. The scheduler stays generic: it knows nothing of GitHub.
2. **The run's record picks the coding agent and model.** Readiness and Claude's quota are checked per run; a run that cannot go now is skipped with one line and tried next minute.
3. **New means after the run last ended.** No "since" time is kept; a comment that comes while the run works is picked up after it ends. An agent that ended leaving a red check is not woken for it again and again.
4. **Only this computer's runs**: a run whose record names another host is left to that computer.
5. **`replies` in the GitHub skill**: the open pull requests this computer's runs opened, and what came on each after its run ended: maintainers' comments and reviews, checks turned red, a conflict with the base branch. About one GitHub call a minute.
6. **A new `reply` skill, a skill file only**, like `post-merge-cleanup`: its front matter is the row (resumes, check `npx @openagt/skill-github@0.1 replies`); its text says read the whole thread again first, then for each comment fix and push, answer, or leave it, and say which; a red check: fix and push; a conflict: merge the base branch in, never force-push, and say on the thread when it cannot resolve it with confidence.
7. **The Automations page**: the row is off by default, shows how often it checks and how many answers may run at once, and "Answers on the coding agent and model that opened the pull request".
8. **Only maintainers' comments count** (people who can write to the repository). The agent's own comments carry the 🤖 line and never count.
9. **When the run cannot be resumed** (its conversation is gone): a new run on the same coding agent and model, which reads the previous run's record and chat, and the thread, first.
10. **A pull request with no run behind it: nothing happens.** Later, worth a try: a maintainer's comment calling OpenAgent (`/openagent …`) there starts a new run, a second row of the `reply` skill.

Not part of this: a watcher, a webhook, or GitHub calling the machine (the scheduler asks, as every row does); a session that stays alive between comments.

## Why it matters

The agent that wrote the code knows why it is so, what was tried and dropped, and what was promised on the thread; a fresh agent does not. A run's record keeps its pull request, host, coding agent and model, and `run --resume <id>` continues an ended run with the same record, branch and conversation: nothing connects the two, no row can resume a run.

## Build order

1. Resume rows in the scheduler, tested with a pretend skill whose check prints a run id.
2. `replies` in the GitHub skill, and the `reply` skill.
3. A try on a test repository: a run opens a pull request; then a comment, a failing test and a conflicting merge to `main`, each answered by the same run.
4. Later: the run's page shows that the words came from a GitHub comment, with its link.

## Notes

- https://github.com/nitedani/mergeworthy works this way ("the session is the agent"), with a watcher service because Claude Code has no clock and its sessions never end. OpenAgent has the clock (the scheduler), the state (the records), the wake (resume) and one agent per pull request (the run lock), so "wake the session" becomes "resume the run".
