import type { AskExchange } from '@/types/ask.types'

/** An exchange as the model reads it back in a follow-up; a skill's prompt stays on the server. */
export function turnQuestion({ question, skill }: Pick<AskExchange, 'question' | 'skill'>): string {
  return skill === 'find-on-web' ? `Find "${question}" on the web` : question
}
