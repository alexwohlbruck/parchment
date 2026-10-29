import { AxiosError } from 'axios'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.enums'
import type {
  FeedbackCapability,
  FeedbackBoard,
  FeedbackSubmission,
  SubmittedFeedback,
  FeedbackIdentity,
  FeedbackPortalLogin,
} from '../types/integration.types'
import { logError } from '../lib/logger'

export type { FeedbackBoard, FeedbackSubmission, SubmittedFeedback }

export class FeedbackNotConfiguredError extends Error {
  constructor() {
    super('Feedback is not configured')
  }
}

/**
 * Resolve whichever configured integration provides feedback. Looked up per
 * call rather than captured, so an admin can connect or change the provider
 * without a restart.
 */
function provider(): FeedbackCapability {
  const records = integrationManager.getConfiguredIntegrationsByCapability(
    IntegrationCapabilityId.FEEDBACK,
  )

  for (const record of records) {
    const instance = integrationManager.getCachedIntegrationInstance(record)
    if (instance?.capabilities.feedback) return instance.capabilities.feedback
  }

  throw new FeedbackNotConfiguredError()
}

/** Whether anything can collect feedback — what gates the in-app entry points. */
export function isFeedbackConfigured(): boolean {
  try {
    provider()
    return true
  } catch {
    return false
  }
}

// async so a missing provider rejects rather than throwing synchronously —
// otherwise `listBoards().catch(...)` would miss it.
export async function listBoards(): Promise<FeedbackBoard[]> {
  return provider().listBoards()
}

export async function submitFeedback(
  input: FeedbackSubmission,
): Promise<SubmittedFeedback> {
  return provider().submitFeedback(input)
}

export function isFeedbackPortalLoginEnabled(): boolean {
  try {
    return provider().isPortalLoginEnabled?.() ?? false
  } catch {
    return false
  }
}

export async function createFeedbackPortalLogin(
  identity: FeedbackIdentity,
  postUrl?: string,
): Promise<FeedbackPortalLogin> {
  const feedback = provider()
  if (!feedback.isPortalLoginEnabled?.() || !feedback.createPortalLogin) {
    throw new FeedbackNotConfiguredError()
  }
  return feedback.createPortalLogin(identity, postUrl)
}

/** Normalise an upstream failure into a message safe to show the user. */
export function feedbackErrorMessage(error: unknown): string | null {
  const upstream = (error as AxiosError<any>)?.response?.data?.error
  if (upstream?.message) return upstream.message
  logError('Feedback provider request failed', undefined, {
    message: error instanceof Error ? error.message : 'Upstream request failed',
    status: (error as AxiosError)?.response?.status,
  })
  return null
}
