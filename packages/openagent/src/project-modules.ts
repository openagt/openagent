import { readModule, type ProjectModule } from '@openagt/skill-ui'
import { broughtToProjects, builtInPackagesOf, computerPackages, ownPackages } from './built-in.js'

/**
 * The modules a project has: each of its dependencies whose package.json exports `./dashboard` to
 * a file that exists inside the package, plus the modules among the packages OpenAgent brings to
 * this project (`built-in.ts`): a skill's page where the project holds the skill's text. Sorted
 * by name.
 */
export async function readProjectModules(root: string): Promise<ProjectModule[]> {
  const modules: ProjectModule[] = []
  for (const pkg of [...(await ownPackages(root)), ...(await builtInPackagesOf(root))]) {
    const module = await readModule(pkg)
    if (module) modules.push(module)
  }
  return modules.sort((a, b) => a.package.localeCompare(b.package))
}

/** The one module of this project that `name` names, or undefined. */
export async function findProjectModule(root: string, name: string): Promise<ProjectModule | undefined> {
  return (await readProjectModules(root)).find(module => module.package === name)
}

/**
 * The modules that are this computer's and no project's: the ones among the packages OpenAgent
 * brings for the computer (`built-in.ts`). They are there with no project added. Sorted by name.
 */
export async function readComputerModules(): Promise<ProjectModule[]> {
  const modules: ProjectModule[] = []
  for (const pkg of await computerPackages()) {
    const module = await readModule(pkg)
    if (module) modules.push(module)
  }
  return modules.sort((a, b) => a.package.localeCompare(b.package))
}

/** The one module of this computer's that `name` names, or undefined. */
export async function findComputerModule(name: string): Promise<ProjectModule | undefined> {
  return (await readComputerModules()).find(module => module.package === name)
}

/**
 * The module of a package OpenAgent brings to projects, from OpenAgent's own copy: the page of
 * another computer's project, on a computer where no project of its own has it. Undefined for any
 * other package.
 */
export async function findBroughtModule(name: string): Promise<ProjectModule | undefined> {
  const pkg = (await broughtToProjects()).find(brought => brought.name === name)
  return pkg ? readModule(pkg) : undefined
}
