import type { MutationHandler } from './types'

/**
 * Mutation handlers, keyed by queue-entry `type`. The queue is persisted but
 * handlers are code — each feature registers its handlers at module load
 * (side-effect import from the feature's service), so entries written by a
 * previous session can replay in this one.
 */
const handlers = new Map<string, MutationHandler>()

export function registerMutationHandler<P>(
  type: string,
  handler: MutationHandler<P>,
): void {
  handlers.set(type, handler as MutationHandler)
}

export function getMutationHandler(type: string): MutationHandler | undefined {
  return handlers.get(type)
}
