import type { AgentMeta, AgentStatus } from '../store/agent-store.js'

/** One run of a project, as a module sees it: what a page or a card shows of a run, and no more. */
export interface ModuleAgent {
  /** The run's id, the one `ModuleHost.openAgent` takes. */
  id: string
  /** The run's branch, the name the agent gave its work, when its record carries one. */
  name?: string
  /** What the run was asked, as typed or as queued; absent when its record carries none. */
  ask?: string
  /** How it stands: `unknown` while the computer it runs on does not answer, whatever its record last said. */
  status: AgentStatus
  /** ISO 8601. */
  startedAt: string
  /** ISO 8601, once it ended. */
  endedAt?: string
  /** Its short name, as a list of runs shows it. */
  title?: string
  /** Whose run it is, by the email its record is kept under. */
  person?: string
  /** What it cost so far, in US dollars. */
  cost?: number
  /** The coding agent that runs it (`claude-code`, `codex`, …) and its model. */
  driver?: string
  model?: string
  /** The saved machine it runs on, by the name it was given; absent for a run of this computer's. */
  machine?: string
  /** While its status is `unknown`: when its computer was last seen, ISO, if it was. */
  seenAt?: string
}

/**
 * Which of a project's runs a module asks for, when not all of them: a project keeps every run it
 * ever made, hundreds, and a card shows a few. Both given, a run must be both.
 */
export interface ModuleAgentsWanted {
  /** These runs only, by id: the ones holding a claim. */
  ids?: string[]
  /** The runs started at this time or later, ISO 8601: the last 30 days. */
  since?: string
}

/** A run as a module sees it. */
export function moduleAgentOf(agent: AgentMeta): ModuleAgent {
  return {
    id: agent.id,
    status: agent.status,
    startedAt: agent.startedAt,
    ...(agent.branch ? { name: agent.branch } : {}),
    ...(agent.intent ? { ask: agent.intent } : {}),
    ...(agent.endedAt ? { endedAt: agent.endedAt } : {}),
    ...(agent.title ? { title: agent.title } : {}),
    ...(agent.person ? { person: agent.person } : {}),
    ...(agent.cost !== undefined ? { cost: agent.cost } : {}),
    ...(agent.driver ? { driver: agent.driver } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.remoteLabel ? { machine: agent.remoteLabel } : {}),
    ...(agent.seenAt ? { seenAt: agent.seenAt } : {}),
  }
}

/** The runs a module asked for, as it sees them. */
export function moduleAgents(agents: readonly AgentMeta[], wanted: ModuleAgentsWanted = {}): ModuleAgent[] {
  const ids = wanted.ids ? new Set(wanted.ids) : undefined
  const since = wanted.since !== undefined ? Date.parse(wanted.since) : undefined
  return agents.filter(agent => (!ids || ids.has(agent.id)) && (since === undefined || Date.parse(agent.startedAt) >= since)).map(moduleAgentOf)
}
