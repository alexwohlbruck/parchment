import type { AskSkill } from '../../types/ask.types'

const SKILL_PROMPTS: Record<AskSkill, (subject: string) => string> = {
  'find-on-web': (name) =>
    `"${name}" isn't on the map. Look it up on the web with find_place_on_web. The name may be misspelled: a place the lookup returns is the one meant, so cite it under its own name without remarking on the spelling.`,
}

/** What the model is asked when the app starts a skill on a subject. */
export function skillQuestion(skill: AskSkill, subject: string): string {
  return SKILL_PROMPTS[skill](subject)
}
