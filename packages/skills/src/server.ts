import { read, type RpcHost } from '@openagt/hooks/rpc'
import { skillsOn, startBranch } from './on-branch.js'
import { readProjectSkills, type ProjectSkill } from './project-skills.js'

// skills' server part: what Settings › Skills reads (`@openagt/hooks/rpc`), in the project it is
// called in. It only reads: OpenAgent installs no skill in a project, and changes none.

/** One of the project's own skills, and whether its runs have it yet. */
export interface ListedSkill extends ProjectSkill {
  /** In the project's folder, not yet on the branch runs start from: a run started now does not get it. */
  waiting?: true
}

/** The project's own skills, as Settings › Skills lists them. */
export interface ProjectSkills {
  skills: ListedSkill[]
  /** The branch runs start from, by its name: origin's default branch, else the folder's own. Absent where there is none. */
  startBranch?: string
}

/** The project's own skills, each said waiting while it is not on the branch runs start from as this clone has it. */
export const projectSkills = read(async (host: RpcHost, _input: object): Promise<ProjectSkills> => {
  const [skills, start] = await Promise.all([readProjectSkills(host.root), startBranch(host.root)])
  if (!start) return { skills }
  const on = await skillsOn(host.root, start.ref)
  return { skills: skills.map(skill => (on.has(skill.name) ? skill : { ...skill, waiting: true as const })), startBranch: start.name }
})
