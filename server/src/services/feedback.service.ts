import axios, { AxiosError } from 'axios'
import { getFeedbackConfig } from '../config/feedback.config'
import { logError } from '../lib/logger'

export interface FeedbackBoard {
  id: string
  name: string
  slug: string
  description: string | null
}

export interface FeedbackAuthor {
  email: string
  name?: string
}

export interface SubmitFeedbackInput {
  boardId: string
  title: string
  content: string
  author: FeedbackAuthor
}

export interface SubmittedFeedback {
  id: string
  url: string | null
}

export class FeedbackNotConfiguredError extends Error {
  constructor() {
    super('Feedback is not configured')
  }
}

/**
 * Resolve the admin-configured instance per call — an admin can connect or
 * change it at runtime, so nothing may be captured at module load.
 */
function client() {
  const config = getFeedbackConfig()
  if (!config) throw new FeedbackNotConfiguredError()

  return {
    api: axios.create({
      baseURL: `${config.url}/api/v1`,
      headers: { Authorization: `Bearer ${config.apiKey}` },
      timeout: 10_000,
    }),
    url: config.url,
  }
}

/**
 * Boards change rarely and every dialog open needs them, so keep a short cache
 * rather than round-tripping to Quackback on each request.
 */
const BOARDS_TTL_MS = 5 * 60_000
let boardsCache: { boards: FeedbackBoard[]; expiresAt: number } | null = null

export async function listBoards(): Promise<FeedbackBoard[]> {
  const { api } = client()

  if (boardsCache && boardsCache.expiresAt > Date.now()) return boardsCache.boards

  const { data } = await api.get('/boards')
  const boards: FeedbackBoard[] = (data?.data ?? []).map((board: any) => ({
    id: board.id,
    name: board.name,
    slug: board.slug,
    description: board.description ?? null,
  }))

  boardsCache = { boards, expiresAt: Date.now() + BOARDS_TTL_MS }
  return boards
}

/** Exposed for tests and for picking up boards created since the last fetch. */
export function clearBoardsCache() {
  boardsCache = null
}

/**
 * File a post on the user's behalf. Their Parchment account is mirrored into
 * Quackback as a portal user so the post carries their name and they get
 * notified when it ships.
 */
export async function submitFeedback({
  boardId,
  title,
  content,
  author,
}: SubmitFeedbackInput): Promise<SubmittedFeedback> {
  const { api, url } = client()

  const { data: identified } = await api.post('/users/identify', {
    email: author.email,
    ...(author.name ? { name: author.name } : {}),
  })
  const authorPrincipalId = identified?.data?.principalId

  const { data: created } = await api.post('/posts', {
    boardId,
    title,
    content,
    ...(authorPrincipalId ? { authorPrincipalId } : {}),
  })

  const id = created?.data?.id
  const slug = (await listBoards()).find(board => board.id === boardId)?.slug

  return {
    id,
    url: slug && id ? `${url}/b/${slug}/posts/${id}` : null,
  }
}

/** Normalise an upstream failure into a message safe to show the user. */
export function feedbackErrorMessage(error: unknown): string | null {
  const upstream = (error as AxiosError<any>)?.response?.data?.error
  if (upstream?.message) return upstream.message
  logError('Quackback request failed', error)
  return null
}
