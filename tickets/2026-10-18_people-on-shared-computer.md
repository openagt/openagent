Topics: remote-access, servers, security
Issue: [#2140](https://github.com/openagt/openagent/issues/2140)

# People on a shared computer: each person's own runs, logins and laptops

## TLDR

A computer several people use (a server, or a computer at home several people start agents on from their own laptops) gives each person their own runs, logins and laptops' lines. A person is their GitHub account; a run uses the GitHub and Claude logins of whoever started it; each person keeps their own copy of a project there. Others' runs reach a person through GitHub (`agent-data`), read only. Only the computer's owner invites. Whoever connects a computer to a shared one picks who may use it: only them, or everyone there. A computer only one person uses is unchanged: OpenAgent asks who you are only at the first Invite.

## Why it matters

Today a server has one OpenAgent and no idea of people. Whoever is invited can reach every laptop connected to it and acts with the server's logins (a GitHub login copied from the laptop pushes as the laptop's owner), and the line's address on the server (`remote-access/src/line-in.ts`) takes no key, so any agent there can call it. Until this is built, a server a laptop is connected to is not shared.

## The catch

Agents run as the same user as OpenAgent, so a limit enforced only in the page is no limit for someone who can start a run. Each person's agents must run as a system user of their own.

## Build order (one pull request each)

1. **Persons**: a device belongs to a person (a GitHub account); the owner is named at the first Invite; Invite asks "Who is it for?" ("Me", or "Someone else: their GitHub account"); devices listed by person; the door passes who a call is from in its own header, stripping any a request brings. Changes nothing yet about what a person can do; the Invite dialog says so.
2. **A user per person**: each person's agents run as their own system user holding their GitHub and Claude logins (`claude setup-token`); the server checks the person's GitHub login matches.
3. **Who sees and does what**: a person's page shows and acts on their own runs; must close the gap of an agent calling OpenAgent on `127.0.0.1:4200` with no key, counted as the owner.
4. **Lines per person**: a connected computer is offered in "Run on" to its person, or to everyone, as picked.
5. **A home computer from a laptop, through a server**: laptop → server → that computer.

The issue holds the full plan for PR 1 by package (`remote-access`, `servers`, `openagent`) and links the conversation behind the picks.
