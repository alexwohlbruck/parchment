export type CommandUse = { id: string; at: number }

export const COMMAND_USE_LIMIT = 20
export const SUGGESTED_COMMAND_LIMIT = 5

const DAY_MS = 86_400_000

export function recordCommandUse(
  uses: CommandUse[],
  id: string,
  now: number,
): CommandUse[] {
  return [...uses, { id, at: now }].slice(-COMMAND_USE_LIMIT)
}

/** Each use counts 1 on the day it happened, ½ a day later, ⅓ after two, and so on. */
export function commandWeights(
  uses: CommandUse[],
  now: number,
): Map<string, number> {
  const weights = new Map<string, number>()
  for (const { id, at } of uses) {
    const ageDays = Math.max(0, now - at) / DAY_MS
    weights.set(id, (weights.get(id) ?? 0) + 1 / (1 + ageDays))
  }
  return weights
}

export function suggestCommands<T extends { id: string }>(
  commands: T[],
  uses: CommandUse[],
  now: number,
  limit = SUGGESTED_COMMAND_LIMIT,
): T[] {
  const weights = commandWeights(uses, now)
  return commands
    .filter(command => weights.has(command.id))
    .sort((a, b) => weights.get(b.id)! - weights.get(a.id)!)
    .slice(0, limit)
}
