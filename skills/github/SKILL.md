---
name: github
description: "The project's git host is GitHub: how to open your pull request when you are asked to, how to land it, and how to read and close the project's issues."
package: "@openagt/skill-github@0.1"
---

# GitHub

The project's pull requests and issues are on GitHub. This skill is how you reach them.

## The command

Run the `github` command inside your checkout, always by its full name: `npx @openagt/skill-github@0.1`. It prints JSON; a refusal exits 1 with a line on stderr; a wrong command line exits 2 with the usage.

## Your pull request

Open a pull request only when your task or the person asks for one, or asks you to publish your work. Push your branch first (your branches skill says how), then:

```
npx @openagt/skill-github@0.1 open --title "<one line naming what the change does>" --body "<what changed, and why>"
```

It opens the pull request for the branch you are on and prints it in `request` (`number`, `url`). A branch that already has an open pull request gets no second one: that one is answered, with `existing` true. Add `--merge` when the work may land on its own: the pull request then merges once its checks pass, also where the repository does not allow auto-merge (`merge` in the answer says `auto-armed`, `merged` or `watching`). Add `--draft` instead for a pull request a person should look at first; with `--merge` too, `--draft` is dropped.

A pull request whose body has a line `Closes #<number>` closes that issue when it merges.

## Commenting on an issue or a pull request

```
npx @openagt/skill-github@0.1 comment <number> --body "<text>"
```

It posts a new comment, opened with what you run on, so what you post is told apart from what people write. Always comment this way, never with `gh`.

## Reading pull requests and issues

```
npx @openagt/skill-github@0.1 requests [--branch <b>] [--state open|merged|all] [--since <iso>]
```

The project's newest 50 pull requests, newest first, all states unless `--state`, only `<b>`'s with `--branch`; `--since` keeps those created since, or merged since with `--state merged`. Each has `number`, `url`, `state` (`open`, `merged`, `closed`), `title`, `draft`, `branch`, `head`, `createdAt`, and for a merged one `mergedAt` and `mergeCommit` (the commit it landed as).

For a pull request's discussion and diff, and for the project's issues, use `gh` directly: `gh pr view <number> --comments`, `gh pr diff <number>`, `gh issue list`, `gh issue view <number> --comments`. `gh` is installed and logged in where you run.

## Landing a pull request for a person

```
npx @openagt/skill-github@0.1 merge <number>
```

A draft is marked ready, then the merge is armed as `--merge` arms it: `outcome` says `auto-armed`, `merged` or `watching`; a request no longer open is refused as `not-open`. Only when whoever started you asked you to land it.
