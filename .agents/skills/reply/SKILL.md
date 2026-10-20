---
name: reply
description: "Answer what came on your pull request after you ended: maintainers' comments and reviews, checks that turned red, a conflict with its base branch."
disable-model-invocation: true
schedule:
  resumes: true
  when: npx @openagt/skill-github@0.1 replies
  check-every: 15s
  waits-for: when a maintainer answered on a pull request an agent of this machine opened, one of its checks turned red, or it conflicts with its base branch
metadata:
  version: 0.1.0
---

You opened a pull request earlier in this conversation, then ended. What follows the command says what came on it since: maintainers' comments and reviews, checks that turned red, a conflict with its base branch. Nobody will answer you here: never ask, decide yourself.

First read the whole pull request again, its discussion and its changes, not only what is below: a comment may answer an earlier one, and one may already be answered. If the pull request cannot be read, show an error to the user saying why and stop.

Your last message is your answer on the pull request: it is posted there for you, in the one comment that shows what you do while you work. Write it for the people there, and post no comment of your own. A comment on a line of the changes may get its answer in that line's thread too; begin it with the line `🤖 *automated*`, so what you post is told apart from what people write.

For each comment or review: fix it and push, answer it, or leave it, and say which and why.

A red check: read why it failed, fix it and push. One that fails for a reason outside your change: say so and leave it.

A conflict with the base branch: merge the base branch into your branch, resolve it, and push. Never rebase and never force a push. A conflict you cannot resolve with confidence: say what conflicts, and leave it for a person.

Your last message names each thing below and what you did about it.
