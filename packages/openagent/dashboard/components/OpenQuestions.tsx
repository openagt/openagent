import { ArrowRight } from 'lucide-react'
import type { OpenQuestion } from '../../src/index.js'
import { onOpenQuestions } from '../rpc/reads.js'
import { usePolled } from '../lib/use-async.js'
import { formatRelative } from '../lib/format-date.js'

/** Stable initial for the poll, so it does not churn on every render. */
const EMPTY_QUESTIONS: OpenQuestion[] = []

/**
 * The agents that wait on the person, as rows: one line per agent, longest-waiting first, from
 * the server. A row says who waits and on what, and opens the agent; the question is answered
 * there, in the panel above the message box, never here.
 */
export function OpenQuestions({
  projectId = null,
  onOpenAgent,
}: {
  /** The one project whose questions show (#1513): the project picked in the sidebar; null shows every project's. */
  projectId?: string | null
  /** Open the agent a question belongs to — it may be another project's. */
  onOpenAgent: (projectId: string, agentId: string) => void
}) {
  const { value: polled, loaded } = usePolled<OpenQuestion[]>(onOpenQuestions, EMPTY_QUESTIONS, 5000, [])
  const questions = projectId === null ? polled : polled.filter(q => q.projectId === projectId)

  // No section at all when nothing waits: an empty "Waiting on you" is noise on every launch.
  if (!loaded || questions.length === 0) return null

  return (
    <section aria-label="Open questions" className="p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Waiting on you · {questions.length}
      </h2>
      {/* A long list scrolls in place, so the rest of the Overview stays in reach. */}
      <ul className="max-h-[70vh] overflow-x-hidden overflow-y-auto">
        {questions.map(question => {
          const label = agentLabel(question)
          const waiting = formatRelative(question.updatedAt, '')
          return (
            // Keyed by the agent, not the question: a row stays put when its agent asks the next one.
            <li key={`${question.projectId} ${question.agentId}`}>
              <button
                type="button"
                aria-label={`Open ${label}: needs input, ${question.choice.title}`}
                onClick={() => onOpenAgent(question.projectId, question.agentId)}
                className="flex w-full items-center overflow-hidden whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/40 md:gap-3 max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-0.5"
              >
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-warning">
                  <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
                  Needs input
                </span>
                {/* The title and the question are the two parts that give up width, each cut with an
                    ellipsis: in a narrow column the row still fits, and nothing scrolls sideways. */}
                <span className="min-w-0 shrink truncate text-foreground md:max-w-[50%] max-md:flex-1">{label}</span>
                <span className="min-w-0 truncate text-muted-foreground md:flex-auto max-md:order-last max-md:basis-full">{question.choice.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{question.projectName}</span>
                {waiting && <span className="shrink-0 text-xs text-muted-foreground">{waiting}</span>}
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The row's title for its agent: the first line of its intent, else its id. */
function agentLabel(q: OpenQuestion): string {
  return q.intent?.split('\n')[0]?.slice(0, 80) ?? q.agentId
}
