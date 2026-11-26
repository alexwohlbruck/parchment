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
import { toWebp } from '../lib/webp'
import { blobStore, publicUrl } from './storage/storage.service'

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

const SCREENSHOT_MAX_EDGE = 2048

async function storeScreenshot(image: Uint8Array) {
  const webp = await toWebp(image, {
    width: SCREENSHOT_MAX_EDGE,
    height: SCREENSHOT_MAX_EDGE,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const key = `feedback/${crypto.randomUUID()}.webp`
  await blobStore.put(key, webp, 'image/webp')
  return key
}

/** Post body in markdown: the user's text, then each screenshot as an image. */
function withScreenshots(content: string, urls: string[]) {
  const images = urls.map((url, i) => `![Screenshot ${i + 1}](${url})`)
  return [content, ...images].filter(Boolean).join('\n\n')
}

/**
 * Screenshots are stored first so the post can link them; the provider copies
 * them from there. A post that fails takes its screenshots with it.
 */
export async function submitFeedback({
  screenshots = [],
  ...input
}: FeedbackSubmission & { screenshots?: Uint8Array[] }): Promise<SubmittedFeedback> {
  const feedback = provider()
  const keys = await Promise.all(screenshots.map(storeScreenshot))
  try {
    return await feedback.submitFeedback({
      ...input,
      content: withScreenshots(input.content, keys.map(publicUrl)),
    })
  } catch (error) {
    await Promise.allSettled(keys.map((key) => blobStore.delete(key)))
    throw error
  }
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
