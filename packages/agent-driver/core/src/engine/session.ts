import { AgentExitError } from '../cli-session.js'
import { ConversationGoneError } from '../gone.js'
import { imagesOf, promptLines, promptOf, takeInbox } from '../inbox.js'
import { errorMessage } from '@openagt/agent-data'
import type { RunAsking, RunOutcome, DriverPromptOptions, DriverSession, DriverTurn, LogEndStatus, PromptLine, Question } from '@openagt/hooks'
import type { Leg } from './leg.js'
import { inboxPath } from './live-card.js'
import { publishChange, type Publish } from './records.js'
import { isBareCommand, nameRun } from './title.js'

/**
 * The agent's session: its turns from the first prompt this process sends to the end of the last
 * one it owes the agent. No system prompt and no gates: the command's skill file is the whole
 * instruction, and the agent publishes its own work, when asked to, through the skills in its
 * checkout. How far it takes its work is the run's publish level, said in one sentence after the
 * prompt: commit the work, and from there push the branch, open its pull request, or set it to
 * merge once its checks pass. The sentence follows every message the agent is sent, a queued one
 * too, and the record keeps it apart from the message. A run with no level gets its prompt as
 * written, and its agent commits only when the prompt asks.
 *
 * What reaches the agent from outside comes through the session's inbox: a message written while a
 * turn runs reaches the agent at its next step, and a line still waiting when a turn ends becomes
 * the next turn. A run that asks the person (`RunContext.asking`, ask's) reads the question a turn's
 * message ends on as its module writes one; when the last turn ended on a question, the agent's
 * tool's or its message's, and nothing waited, the run ends `waiting`, and the answer continues
 * it. A run that does not ask just ends, as done: the person replies with a message.
 */

/** How long naming a run from its report may hold its end up: the small model answers in a few seconds. */
const REPORT_NAMING_TIMEOUT_MS = 15_000

/** The detail a stopped run's record carries. */
export const STOPPED_DETAIL = 'stopped by a signal to its process'

/** What a run's end says beside its status: why it failed, or that a signal stopped it. */
export function detailOf(outcome: RunOutcome): string | undefined {
  return outcome.status === 'failed' ? outcome.error : outcome.status === 'stopped' ? STOPPED_DETAIL : undefined
}

const COMMIT_OPENING = 'When you finish, if you changed any file, commit your work'
const PUBLISH_OPENING = `${COMMIT_OPENING}, push your branch`

/** The sentence after a prompt that says how far to take the work, every level starting with the commit; how is the business of the skills in the checkout. */
export const PUBLISH_LINES: Readonly<Record<Publish, string>> = {
  commit: `${COMMIT_OPENING}.`,
  branch: `${PUBLISH_OPENING} and open no pull request.`,
  pr: `${PUBLISH_OPENING} and open its pull request.`,
  merge: `${PUBLISH_OPENING} and open its pull request, set to merge on its own once its checks pass.`,
}

const OPENS_REQUEST = 'open its pull request'

/**
 * The copies of the repos a run has as context: their folders, and whether they are all the run
 * has to publish, as in a session with no project, or stand beside its checkout of a project.
 */
export interface Copies {
  folders: readonly string[]
  alone: boolean
}

/**
 * The sentence a run adds after every prompt of its agent, the first and each message after it:
 * that of its publish level, none for a run with none, naming the branch its pull request goes
 * into at a level that opens one. The session sends it after the prompt and writes it down apart
 * from it, so a reader shows the person's words as the person wrote them.
 *
 * One level holds for all the run works in (his pick, over a level per repo): a run with copies
 * of repos is told to take each one it changed as far, on the copy's own branch. A session with
 * no project and no copy has nothing to publish, and gets no sentence.
 */
export function addedLine(publish: Publish | undefined, prBase?: string, copies?: Copies): string | undefined {
  if (publish === undefined) return undefined
  const folders = copies?.folders ?? []
  if (copies?.alone === true && folders.length === 0) return undefined
  const line = prBase !== undefined ? PUBLISH_LINES[publish].replace(OPENS_REQUEST, `${OPENS_REQUEST} into the branch ${prBase}`) : PUBLISH_LINES[publish]
  if (folders.length === 0) return line
  const each = `each copied repo you changed, on its own branch there: ${folders.join(', ')}.`
  return copies?.alone === true ? `${line} That is for ${each}` : `${line} Do the same in ${each}`
}

/** The model as a card or a session takes it: named, or left out so the tool starts on its own default. */
export function modelOf(model: string | undefined): { model?: string } {
  return model !== undefined ? { model } : {}
}

/** How hard the model may think, the same way: named, or left out so the tool thinks as it does by default. */
export function effortOf(effort: string | undefined): { effort?: string } {
  return effort !== undefined ? { effort } : {}
}

/** A prompt this process owes the agent, and the level a message taken from the inbox after the run's last turn gave the run with it. */
interface Queued {
  prompt: string
  publish?: string
  /** The images it goes with, by their names in the image store. */
  images?: string[]
}

/** An inbox line as the prompt it becomes, with the level its message carries. */
function queued(line: PromptLine): Queued {
  return { prompt: promptOf(line), ...(line.kind === 'message' && line.publish !== undefined ? { publish: line.publish } : {}), ...imagesOf(line) }
}

/**
 * The agent's session in `workspace`, from its start to the end of the last turn this process owes
 * it, its live record kept in `dir`: how the run ended. A signal to stop asks the agent to end its
 * turn where it is; `leg.killed` ends its process tree at once. `asking` is how the run asks the
 * person, when it does. `context` is what the steps before had to tell the agent
 * (`RunContext.context`): handed over with the first prompt this process sends, after the text
 * the run was given to attach. `copies` is the copies of repos the run has, which its publish
 * sentence names.
 */
export async function sessionTurns(leg: Leg, workspace: string, dir: string, stopped: AbortSignal, env: Readonly<Record<string, string>>, asking?: RunAsking, context: readonly string[] = [], copies?: Copies): Promise<RunOutcome> {
  const { id: _id, status: _status, endedAt: _endedAt, ...startCard } = leg.card
  const continued = leg.earlier !== undefined
  const resumeSessionId = leg.earlier?.sessionId
  const inbox = inboxPath(workspace)
  let end: RunOutcome = { status: 'done' }
  let driverSession: DriverSession | undefined
  try {
    driverSession = await leg.driver.start({
      cwd: workspace,
      env,
      ...modelOf(leg.model),
      ...effortOf(leg.effort),
      signal: leg.killed,
      stop: stopped,
      ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
      log: { dir, card: { id: leg.id, ...startCard }, continue: continued },
    })
  } catch (err) {
    end = { status: 'failed', error: errorMessage(err) }
  }
  if (driverSession?.log) leg.live = driverSession.log
  const naming = nameSession(leg, driverSession, stopped)
  const level = publishLevel(leg, driverSession, copies)
  try {
    // The prompts this process owes the agent: the run's own, then the lines that reached the
    // inbox after the last turn took it but while the card still said running. Whoever wrote
    // them was told the run has them, so this process sends them before it lets the run go.
    let queue: Queued[] = [{ prompt: leg.prompt, ...(leg.images !== undefined && leg.images.length > 0 ? { images: leg.images } : {}) }]
    let resume = continued
    // A continued run whose record names no conversation has none to go on with: it starts afresh.
    let fresh = continued && resumeSessionId === undefined
    // Handed over with the run's own prompt only: the first one this process sends.
    let attached = [...(leg.attached !== undefined ? [leg.attached] : []), ...context].join('\n\n') || undefined
    while (driverSession) {
      end = { status: 'done' }
      let failure: unknown
      let lastText = ''
      let asked: Question | undefined
      try {
        for (const [i, { prompt, publish, images }] of queue.entries()) {
          // Stopped between two prompts: the rest are not sent.
          if (stopped.aborted) break
          await level.take(publish)
          // Only the last one drains the inbox: a line written meanwhile comes after these.
          const last = i === queue.length - 1
          const handed = attached
          attached = undefined
          const sent = {
            ...(last ? { inbox, onInboxLine: level.onInboxLine } : {}),
            ...(resume ? { resume: true } : {}),
            ...(handed !== undefined ? { attached: handed } : {}),
            ...(images !== undefined ? { images } : {}),
            ...(asking ? { questionIn: asking.questionIn } : {}),
            ...level.added(),
          }
          const session = driverSession
          const turn = fresh
            ? await afresh(session, leg, prompt, sent)
            : await session.prompt(prompt, sent).catch((err: unknown) => {
                if (err instanceof ConversationGoneError) return afresh(session, leg, prompt, sent)
                throw err
              })
          fresh = false
          lastText = turn.text
          asked = turn.question
          resume = true
        }
      } catch (err) {
        end = { status: 'failed', error: errorMessage(err) }
        failure = err
      }
      if (stopped.aborted) end = { status: 'stopped' }
      else if (end.status === 'done' && asking) {
        // The last turn asked and nothing waited in the inbox: the run ends here, waiting, and
        // keeps its checkout for the answer to resume it.
        const question = (asked ?? asking.questionIn(lastText))?.title
        if (question !== undefined) end = { status: 'waiting', question }
      }
      await naming.fromReport(end.status, lastText)

      const live = driverSession.log
      if (!live) break
      // The ended line leaves out a reason the diary already holds: the agent's error line, written
      // just before its process exited, says it, so the ended line says only that the agent exited.
      await live.end(end.status, end.status === 'failed' && failure instanceof AgentExitError ? failure.exit : detailOf(end))
      await live.settled()

      // The card says ended now, so a line written from here on goes to the project's resume
      // hook, which waits for this process. What is in the inbox was written before: this
      // process's to send. A stopped run was stopped on purpose; what reached it is dropped.
      if (end.status === 'stopped' || stopped.aborted) break
      queue = promptLines(await takeInbox(inbox)).map(queued)
      if (queue.length === 0) break
      await live.reopen()
    }
  } finally {
    await driverSession?.dispose().catch(() => {})
  }

  // The name lands on the card before the record is copied: a run named after that copy would be
  // named only in its checkout, which is removed with the run.
  await naming.done
  return end
}

/**
 * The run's short name, asked of a small model beside the first turn (`title.ts`), or as the run
 * began, before its checkout was made, when it was a fresh one no other tool marked (`runCommand`):
 * a run that is being continued was named when it began, and one whose agent never started has
 * nothing to name. `OPENAGENT_NAME_RUN=0` is the person's setting, put in this process's environment by whoever
 * started it: naming costs money for something only a person looks at, so it can be declined.
 * A bare command is named later, from its agent's report (`fromReport`).
 */
function nameSession(leg: Leg, session: DriverSession | undefined, stopped: AbortSignal): { done: Promise<void>; fromReport(status: LogEndStatus, report: string): Promise<void> } {
  const mayName = process.env.OPENAGENT_NAME_RUN !== '0' && session !== undefined && leg.earlier === undefined && leg.card.title === undefined
  let fromReport = mayName && isBareCommand(leg.prompt)
  // A fresh run's name was asked for as the run began (`runCommand`): it is dropped when the run will
  // not take it, and stopped with the run.
  const asked = leg.named
  if (asked && (!mayName || stopped.aborted)) asked.stop.abort()
  else if (asked) stopped.addEventListener('abort', () => asked.stop.abort(), { once: true })
  const titled = async (title: string | undefined): Promise<void> => {
    if (title !== undefined) await session?.log?.title(title)
  }
  // The card says while the name is being asked, and only then: a list holds the run's place for it.
  const asking = mayName && !fromReport
  if (asking) void session?.log?.patch({ caller: { naming: true } })
  return {
    done: asking
      ? (asked?.title ?? nameRun(leg.driver, { prompt: leg.prompt, signal: stopped })).then(titled, () => {}).then(() => session?.log?.patch({ caller: { naming: undefined } }))
      : Promise.resolve(),
    // Named from its first report once its status is settled, before it is said ended, so the
    // name's line in the diary comes before the ended one; a stop meanwhile only cuts the naming
    // short. A question is no report of the work, and a few seconds is all a name may hold the
    // end up.
    async fromReport(status, report) {
      if (!fromReport || status !== 'done' || report.trim() === '') return
      fromReport = false
      await titled(await nameRun(leg.driver, { prompt: report, from: 'report', signal: stopped, timeoutMs: REPORT_NAMING_TIMEOUT_MS }))
    },
  }
}

/**
 * The sentence after every prompt, and the mark that keeps the level it says: a message can change
 * the level from there on (`publish` on its inbox line, or on a line queued after the run's last
 * turn), and the record says so then.
 */
function publishLevel(leg: Leg, session: DriverSession | undefined, copies: Copies | undefined): { added(): { added?: string }; take(word: string | undefined): Promise<void>; onInboxLine(line: PromptLine, sent: DriverPromptOptions): Promise<DriverPromptOptions> } {
  let added = addedLine(leg.mark.publish, leg.mark.prBase, copies)
  const take = async (word: string | undefined): Promise<void> => {
    const level = publishChange(word)
    if (level === undefined) return
    const { publish: _was, ...rest } = leg.mark
    leg.mark = { ...rest, ...(level !== null ? { publish: level } : {}) }
    added = addedLine(leg.mark.publish, leg.mark.prBase, copies)
    await session?.log?.patch({ caller: { runner: leg.mark, publish: leg.mark.publish } })
  }
  return {
    added: () => (added !== undefined ? { added } : {}),
    take,
    // A line the driver takes from the inbox is handed here first: a message may say how far the run
    // takes its work from it on, and every line goes with the sentence in force now, which a line
    // handed over in a later turn may have changed.
    onInboxLine: async (line, sent) => {
      if (line.kind === 'message') await take(line.publish)
      const { added: _was, ...rest } = sent
      return added !== undefined ? { ...rest, added } : rest
    },
  }
}

/** The line a continued run's record gets where its coding agent starts a fresh conversation. */
export const AFRESH_NOTICE = "The coding agent no longer has this run's earlier conversation: a fresh one starts here, told to read this run's record first."

/** What the agent of a run going on in a fresh conversation is handed after its prompt: where its earlier work is. */
export function earlierWorkLine(id: string, pr: { url: string } | undefined): string {
  return `Your earlier conversation in this run is gone, so this one starts without it. Before anything else, read what you did before: this run's record, \`npx @openagt/logs@0.1 show ${id}\`${pr ? `, and the whole thread of its pull request, ${pr.url}` : ''}.`
}

/**
 * A continued run's prompt in a fresh conversation (#2042): its agent no longer has the one the
 * record names, or the record names none. The run stays the same run, its record and branch, and
 * its record says where the fresh conversation starts; the agent reads its own record first, the
 * diary that kept what it said, which outlives the agent's own copy of the conversation.
 */
async function afresh(session: DriverSession, leg: Leg, prompt: string, sent: DriverPromptOptions): Promise<DriverTurn> {
  await session.log?.record({ type: 'notice', message: AFRESH_NOTICE })
  // What this process had to hand over (the copies made for it now) still goes, after the line on the earlier work.
  return session.prompt(prompt, { ...sent, resume: false, attached: [earlierWorkLine(leg.id, leg.card.pr), ...(sent.attached !== undefined ? [sent.attached] : [])].join('\n\n') })
}
