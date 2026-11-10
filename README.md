<img src="./logo.svg?v=2" alt="OpenAgent" align="left" width="170" />

### OpenAgent

**Autonomous AI programming.**  
Stop babysitting your coding agents. Make the important decisions, let AI do the rest.

[![npm](https://img.shields.io/npm/v/@openagt/dashboard)](https://www.npmjs.com/package/@openagt/dashboard) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE) [![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/qc8zvdzWNR)

<br clear="left" />

## What is this?

> We're building an agent orchestration tool that is not only fully open source, but also fully modular which is the unique thing about what we're building: the orchestration is merely a set of skills you can choose and switch out individually. So basically replacing tools like Cursor/Conductor/Traycer with just a set of skills. Our hope is that the entire AI harness eventually becomes open source and modular.

## Quickstart

Install OpenAgent, on macOS or Linux:

```bash
npx @openagt/install
```

From then on, https://openagent.build opens your dashboard, on this computer. It starts when you log in. `npx @openagt/uninstall` takes it off again.

Or try it once, with nothing installed, in your project's folder:

```bash
npx @openagt/dashboard
```

It opens the dashboard in your browser, on your project. Every agent you start gets the default skills (ask, and github on a GitHub project), with nothing written in your project; a skill of your own with the same name takes one's place.

To give the project more skills, as files of its own, tick them on the dashboard's Skills page, which the Skills button under the message box opens. The page lists the skills the dashboard is built on: tickets, the queue, automations, orchestration, logs. The [`skills`](./skills) folder has more (code reviews, research, ticket suggestions); pick any of them with [`skills`](https://github.com/vercel-labs/skills), for any agent:

```bash
npx skills add openagt/openagent
```

Or add one by its name:

```bash
npx skills add openagt/openagent@github
```
