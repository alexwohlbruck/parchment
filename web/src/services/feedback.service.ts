import { api } from '@/lib/api'

export interface FeedbackBoard {
  id: string
  name: string
  slug: string
  description: string | null
}

export interface SubmittedFeedback {
  id: string
  url: string | null
}

export async function fetchFeedbackBoards(): Promise<FeedbackBoard[]> {
  const { data } = await api.get<{ boards: FeedbackBoard[] }>('/feedback/boards')
  return data.boards
}

export async function submitFeedback(input: {
  boardId: string
  title: string
  content: string
}): Promise<SubmittedFeedback> {
  const { data } = await api.post<SubmittedFeedback>('/feedback', input)
  return data
}
