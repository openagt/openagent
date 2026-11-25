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

From then on, https://openagent.build opens your dashboard, on this computer. It starts when you log in, and `openagent` runs the same copy in a terminal. `openagent --uninstall` takes it off again.

Or try it once, with nothing installed, in your project's folder:

```bash
npx @openagt/dashboard
```

It opens the dashboard in your browser, on your project. Every agent you start gets the skills of OpenAgent's core modules (github's on a GitHub project) and of the plugins on in your project, with nothing written in your project; a skill of your own with the same name takes one's place. Each plugin is switched on or off in Settings › Plugins: ask and desktop notifications start on, the others (the tickets, the queue, the logs, the browser, the scheduler…) start off.

A project's own skills are files in it, which the dashboard lists in Settings › Skills; the Skills line in the gear's menu under the message box picks the ones a run gets, and the plugins it goes without. A plugin's skills come with it, in its package, and reach OpenAgent's runs only: the tickets with the commands about them, the queue with work-queue, the logs, and the others.
