// The prompt that resumes an agent after the person answered its question is one fixed sentence
// (`continuationPrompt` in `agent-driver`): the question, then the answer. The chat draws it as
// what it is, a question and its answer, not as a message the person typed. Words of the person's
// own and a skip are said in the same sentence's shape, so they are drawn the same way.

/** The sentence an answer resumes the agent with: `continuationPrompt`'s, so the chat can show it before the agent's own line arrives. */
export function answerPrompt(question: string, answer: string): string {
  return `You paused to ask: "${question}". The user chose: ${answer}. Continue with that decision.`
}

/** What Skip tells the agent: its question, and that it goes on without an answer. */
export function skipPrompt(question: string): string {
  return `You paused to ask: "${question}". The user skipped it. Continue without an answer.`
}

/** The question and the answer a resuming prompt carries (no answer: it was skipped), or undefined for any other prompt. */
export function answeredQuestion(prompt: string): { question: string; answer?: string } | undefined {
  const chose = /^You paused to ask: "([\s\S]*)"\. The user chose: ([\s\S]*)\. Continue with that decision\.$/.exec(prompt)
  if (chose) return { question: chose[1]!, answer: chose[2]! }
  const skipped = /^You paused to ask: "([\s\S]*)"\. The user skipped it\. Continue without an answer\.$/.exec(prompt)
  return skipped ? { question: skipped[1]! } : undefined
}
