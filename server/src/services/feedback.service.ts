import { AxiosError } from 'axios'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
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

/**
 * Attached images are staged here, at unguessable ids, until the provider has
 * fetched its own copy. They stay only if it couldn't, since the post then
 * links to them.
 */
const IMAGES_DIR = resolve(__dirname, '../../data/uploads/feedback')
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const MAX_FEEDBACK_IMAGES = 4
export const MAX_FEEDBACK_IMAGE_BYTES = 10 * 1024 * 1024
/** Large enough to read a desktop screenshot, small enough to fetch quickly. */
const MAX_IMAGE_DIMENSION = 2400

export class InvalidFeedbackImageError extends Error {
  constructor() {
    super('Not a supported image')
  }
}

function imagePath(id: string) {
  return resolve(IMAGES_DIR, `${id}.webp`)
}

/**
 * Re-encode and stage an upload. Re-encoding through sharp both rejects
 * anything that isn't really an image and drops its metadata, so a phone
 * photo's GPS position never reaches a public feedback board.
 */
async function stageImage(file: File): Promise<string> {
  const id = randomUUID()
  try {
    await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toFile(imagePath(id))
  } catch {
    throw new InvalidFeedbackImageError()
  }
  return id
}

async function discardImages(ids: string[]) {
  await Promise.all(ids.map((id) => unlink(imagePath(id)).catch(() => {})))
}

/** A staged image, or null when the id is unknown or malformed. */
export async function readFeedbackImage(id: string): Promise<Buffer | null> {
  if (!IMAGE_ID.test(id)) return null
  return readFile(imagePath(id)).catch(() => null)
}

export async function submitFeedback(
  input: Omit<FeedbackSubmission, 'images'>,
  files: File[] = [],
): Promise<SubmittedFeedback> {
  const feedback = provider()
  if (!files.length) return feedback.submitFeedback(input)

  await mkdir(IMAGES_DIR, { recursive: true })
  const ids: string[] = []
  try {
    for (const file of files) ids.push(await stageImage(file))
  } catch (error) {
    await discardImages(ids)
    throw error
  }

  const origin = (process.env.SERVER_ORIGIN ?? '').replace(/\/+$/, '')
  let submitted: SubmittedFeedback
  try {
    submitted = await feedback.submitFeedback({
      ...input,
      images: ids.map((id) => ({ url: `${origin}/feedback/images/${id}` })),
    })
  } catch (error) {
    await discardImages(ids)
    throw error
  }

  if (submitted.imagesCopied) await discardImages(ids)
  return submitted
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
