export interface OsmNote {
  id: number
  lat: number
  lng: number
  status: 'open' | 'closed'
  comments: OsmNoteComment[]
  createdAt: string
  closedAt?: string
}

export interface OsmNoteComment {
  date: string
  uid?: number
  user?: string
  action: 'opened' | 'commented' | 'closed' | 'reopened'
  text: string
}
