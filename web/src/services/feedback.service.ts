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

export async function submitFeedback({
  screenshots,
  ...fields
}: {
  boardId: string
  title: string
  content: string
  screenshots: File[]
}): Promise<SubmittedFeedback> {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  for (const file of screenshots) form.append('screenshots', file)
  const { data } = await api.post<SubmittedFeedback>('/feedback', form)
  return data
}
