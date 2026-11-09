// Places a route distance on a vertical trip timeline drawn as a column of stops.

export interface TimelineAnchor {
  /** Distance along the route. */
  s: number
  /** Height on the timeline, in pixels. */
  y: number
}

/** Height for route distance `s`, between the anchors either side of it; anchors are ordered by `s`. */
export function timelineY(anchors: TimelineAnchor[], s: number): number | null {
  if (!anchors.length) return null
  if (s <= anchors[0].s) return anchors[0].y
  for (let i = 1; i < anchors.length; i++) {
    const to = anchors[i]
    if (s > to.s) continue
    const from = anchors[i - 1]
    const span = to.s - from.s
    return span > 0 ? from.y + ((s - from.s) / span) * (to.y - from.y) : to.y
  }
  return anchors.at(-1)!.y
}
