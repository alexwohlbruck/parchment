import { api } from '@/lib/api'
import type {
  FeedbackBoardsResponse,
  FeedbackPortalLogin,
  SubmittedFeedback,
} from '@server/types/integration.types'

export type {
  FeedbackBoard,
  SubmittedFeedback,
} from '@server/types/integration.types'

export async function fetchFeedbackBoards(): Promise<FeedbackBoardsResponse> {
  const { data } = await api.get<FeedbackBoardsResponse>('/feedback/boards')
  return data
}

export async function createFeedbackPortalLogin(
  postUrl?: string,
): Promise<FeedbackPortalLogin> {
  const { data } = await api.post<FeedbackPortalLogin>(
    '/feedback/portal-login',
    { postUrl },
  )
  return data
}

/** Matches the server's limits on attachments. */
export const MAX_FEEDBACK_IMAGES = 4
export const MAX_FEEDBACK_IMAGE_BYTES = 10 * 1024 * 1024

export async function submitFeedback(input: {
  boardId: string
  title: string
  content: string
  images?: File[]
}): Promise<SubmittedFeedback> {
  const { images = [], ...fields } = input
  if (!images.length) {
    const { data } = await api.post<SubmittedFeedback>('/feedback', fields)
    return data
  }

  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  for (const image of images) form.append('images', image)
  const { data } = await api.post<SubmittedFeedback>('/feedback', form)
  return data
}
