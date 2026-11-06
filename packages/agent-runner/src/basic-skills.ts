import { readFile, realpath } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { declaring, packageBins, readManifest, runPackageCommand, SKILL_CATALOGUE_ENV, SKILLS_ENV, type AgentRecord, type ProjectPackage, type ProvidedCommand } from '@openagt/agent-data'
import type { SkillLink } from '@openagt/skill-branches'

/**
 * The basic skills (#2023): the ones a run gets with nothing committed in the project, its
 * agent's. Each one's text is linked into the agent's checkout, hidden from git, beside the
 * branches skill the checkout already carries, and with it the skill's package and command, so
 * the text's `npx @openagt/skill-logs@0.1` runs that very copy. A project that tracks its own
 * copy of one keeps it: an entry already in the checkout is left alone.
 *
 * This tool names no skill: the package that started OpenAgent owns the lists and hands them
 * down, in {@link SKILLS_ENV} the directories of the packages of the skills a run gets when no
 * agent says otherwise, in {@link SKILL_CATALOGUE_ENV} those of every skill it carries, which an
 * agent picks from by name; a run started by hand, with nothing set, gets none. A git host's
 * skill is linked only where its package answers the project's page there (its `home` command):
 * its text says the project's pull requests are on that host, which is wrong anywhere else.
 */

interface BasicSkill {
  link: SkillLink
  pkg: ProjectPackage
  /** The package's git host command, when it declares one: asked before its skill is linked. */
  gitHost?: ProvidedCommand
  /** The skill teaches an agent how to ask the person (`"openagent": { "asking": true }`): none for an agent with a tool of its own for that. */
  asking: boolean
}

/** The lists as last read, by the values they were read off: the environment is read on each ask. */
let resolved: { from: string; skills: Promise<{ defaults: BasicSkill[]; carried: BasicSkill[] }> } | undefined

/** The default skills, and every skill carried: the defaults first, then the catalogue's, one entry per skill name. */
function lists(): Promise<{ defaults: BasicSkill[]; carried: BasicSkill[] }> {
  const defaults = process.env[SKILLS_ENV] ?? ''
  const catalogue = process.env[SKILL_CATALOGUE_ENV] ?? ''
  const from = `${defaults}\n${catalogue}`
  if (resolved?.from !== from) {
    resolved = {
      from,
      skills: (async () => {
        const first = await resolveBasic(defaults)
        const names = new Set(first.map(skill => skill.link.name))
        const rest = (await resolveBasic(catalogue)).filter(skill => !names.has(skill.link.name) && names.add(skill.link.name))
        return { defaults: first, carried: [...first, ...rest] }
      })(),
    }
  }
  return resolved.skills
}

/** The skills of the package directories `from` names; one that is no package with a skill's text is skipped. */
async function resolveBasic(from: string): Promise<BasicSkill[]> {
  const skills: BasicSkill[] = []
  for (const named of from.split(delimiter).filter(Boolean)) {
    const dir = await realpath(named).catch(() => undefined)
    const manifest = dir ? await readManifest(join(dir, 'package.json')) : undefined
    const name = typeof manifest?.name === 'string' ? manifest.name : undefined
    const skill = dir ? skillName(await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => '')) : undefined
    if (!dir || !manifest || !name || !skill) continue
    const bins = packageBins(name, manifest.bin, dir)
    const gitHost = declaring([{ name, dir, manifest }], 'git-host')[0]
    const asking = typeof manifest.openagent === 'object' && manifest.openagent !== null && (manifest.openagent as Record<string, unknown>)['asking'] === true
    skills.push({ link: { name: skill, dir, ...(Object.keys(bins).length > 0 ? { package: { name, dir, bins } } : {}) }, pkg: { name, dir, manifest }, ...(gitHost ? { gitHost } : {}), asking })
  }
  return skills
}

/** The `name` a skill's text gives in its front matter: the directory a harness lists it under. */
function skillName(text: string): string | undefined {
  const frontMatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1]
  const name = frontMatter ? /^name:\s*([a-z0-9][a-z0-9-]*)\s*$/m.exec(frontMatter)?.[1] : undefined
  return name
}

/** Every skill handed down, default or carried, whatever the project: what a cleanup takes the rules back for. */
export async function everyBasicSkill(): Promise<SkillLink[]> {
  return (await lists()).carried.map(skill => skill.link)
}

/** The names of every skill carried, in the lists' order: what an agent can be given. */
export async function carriedSkillNames(): Promise<string[]> {
  return (await lists()).carried.map(skill => skill.link.name)
}

/**
 * The basic skills of the project at `repo`, for a run on `on`: the agent's, by name, among the
 * skills carried, the defaults when it is on no agent; a git host's only where it answers for the
 * project, and one that teaches asking only for a coding agent with no question tool of its own.
 * A name the agent has that nothing carried is no skill here.
 */
export async function basicSkills(repo: string, agent: { ownQuestionTool?: boolean } = {}, on?: Pick<AgentRecord, 'skills'>): Promise<SkillLink[]> {
  const { defaults, carried } = await lists()
  const picked = on ? on.skills.flatMap(name => carried.filter(skill => skill.link.name === name)) : defaults
  const skills: SkillLink[] = []
  for (const { link, gitHost, asking } of picked) {
    if (asking && agent.ownQuestionTool === true) continue
    if (gitHost && !(await runPackageCommand(repo, gitHost, ['home'])).ok) continue
    skills.push(link)
  }
  return skills
}

/**
 * The basic packages that answer as the git host of the project at `repo`: what a run reads its
 * pull request back through in a project that installed no git host of its own.
 */
export async function basicGitHosts(repo: string): Promise<ProjectPackage[]> {
  const hosts: ProjectPackage[] = []
  for (const { pkg, gitHost } of (await lists()).carried) {
    if (gitHost && (await runPackageCommand(repo, gitHost, ['home'])).ok) hosts.push(pkg)
  }
  return hosts
}

/** The names of the basic skills' packages: a project's own copy of one is never read as its git host. */
export async function basicPackageNames(): Promise<string[]> {
  return (await lists()).carried.map(skill => skill.pkg.name)
}
