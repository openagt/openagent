<img src="./logo.svg?v=2" alt="OpenAgent" align="left" width="170" />

### OpenAgent

**Autonomous AI programming.**  
Stop babysitting your coding agents. Make the important decisions, let AI do the rest.

[![npm](https://img.shields.io/npm/v/@openagt/start)](https://www.npmjs.com/package/@openagt/start) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE) [![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/qc8zvdzWNR)

<br clear="left" />

## What is this?

[openagent.build](https://openagent.build)

## Quickstart

In your project's folder:

```bash
npx @openagt/start
```

It opens the dashboard in your browser, on your project. Every agent you start gets the default skills (logs, question, github on a GitHub project, orchestration, tickets and queue), with nothing written in your project; a skill of your own with the same name takes one's place.

To give the project more skills, as files of its own, tick them in the dashboard's Skills list, under the message box. Or pick them with [`skills`](https://github.com/vercel-labs/skills), for any agent:

```bash
npx skills add openagt/openagent
```

Or add one by its name:

```bash
npx skills add openagt/openagent@github
```

Or install OpenAgent:

```bash
npm i -g @openagt/start
openagent
```
