---
name: branches
description: Where your work goes (a branch named agent-<name>), how to name it, what must be true before you finish, and how to push it when you are asked to.
---

# Branch management

Your work goes on a branch named `agent-<name>`, unless whoever started you continued you on another. It stays on this machine until you are asked to push it.

## The command

Run the `branches` command inside your checkout, always by its full name: `npx @openagt/skill-branches@0.1`. `status`, `name` and `push` (with no flag) are yours; the rest are the caller's.

## Where you are

```
npx @openagt/skill-branches@0.1 status
```

It prints JSON; `branch` is the branch you are on.

**A branch starting with `agent-`.** Its checkout is your whole workspace: read and write only there. Dependency files and skill folders are links to the user's copies: never edit them. If something you need is outside your checkout, say so and stop.

Before your first change, name the session with `[a-z0-9-]+`, starting with a letter or digit, saying what the work is, unless your branch already differs from `path`'s last segment: then it is named, keep it.

```
npx @openagt/skill-branches@0.1 name <name>
```

It renames your branch to `agent-<name>` and prints it in `branch`: `agent-<name>-2`, `-3`, … when `<name>` was taken; a name outside `[a-z0-9-]+` is refused as `invalid-name`.

**Any other branch.** If the checkout sits under `.branches/`, you were put on this branch on purpose: stay on it, do not name it. Otherwise you are in a plain clone on someone else's branch. Before your first change, create your own and switch to it, `<name>` as above (another if it exists, locally or on origin):

```
git switch -c agent-<name>
```

From then on, work as on an `agent-` branch; nothing in a plain clone is a link.

## Commit as you go

Nothing is committed for you.

## Before you finish

```
npx @openagt/skill-branches@0.1 status
```

It must report `"clean": true`. `clean` is false while anything is uncommitted or untracked: commit or delete what you added; if what remains is not yours, say so and finish.

## Push

Only when your task or the person asks you to push or publish your work, and once clean:

```
npx @openagt/skill-branches@0.1 push
```

It pushes your branch to origin and prints it in `branch`. `clean` false is refused as `dirty`: commit or delete first.

## Merge

Only when the person asks you to merge your work into the project's main branch, and once clean:

```
npx @openagt/skill-branches@0.1 merge <your branch>
```

It merges your branch into the main branch, in the project's own folder. A conflict changes nothing and names the files in `files`: say so and stop. Your checkout and your branch stay.
