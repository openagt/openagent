---
name: reply
description: "Answer what came on your pull request after you ended: maintainers' comments and reviews that call you with /agent, checks that turned red, a conflict with its base branch."
disable-model-invocation: true
schedule:
  resumes: true
  when: npx @openagt/agent-runner@0.0 git-host replies
  check-every: 15s
  waits-for: when a maintainer wrote /agent on a pull request an agent of this machine opened, one of its checks turned red, or it conflicts with its base branch
metadata:
  version: 0.1.1
---

You opened a pull request earlier in this conversation, then ended. What follows the command says what came on it since: maintainers' comments and reviews, checks that turned red, a conflict with its base branch. Nobody will answer you here: never ask, decide yourself.

First read the whole pull request again, its discussion and its changes, not only what is below: a comment may answer an earlier one, and one may already be answered. If the pull request cannot be read, show an error to the user saying why and stop.

Post on the pull request the way your git host skill says. Each time a new comment, never an edit of an earlier one: a new comment reaches people by email, an edit reaches nobody.

If what came will take you more than about 5 minutes, first post a short comment: what you are going to do, and that you will comment here when finished.

For each comment or review: fix it and push, answer it, or leave it, and say which and why.

A red check: read why it failed, fix it and push. One that fails for a reason outside your change: say so and leave it.

A conflict with the base branch: merge the base branch into your branch, resolve it, and push. Never rebase and never force a push. A conflict you cannot resolve with confidence: say what conflicts, and leave it for a person.

When you are done, post your answer: each thing below and what you did about it.
