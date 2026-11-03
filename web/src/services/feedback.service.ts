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

export async function submitFeedback(input: {
  boardId: string
  title: string
  content: string
}): Promise<SubmittedFeedback> {
  const { data } = await api.post<SubmittedFeedback>('/feedback', input)
  return data
}
