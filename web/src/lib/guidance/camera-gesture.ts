// Which camera moves are the user's, and what they do to the navigation camera.

export type CameraState = 'following' | 'free' | 'overview'

/** MapLibre attaches the DOM event to moves a gesture caused; the camera's own eases carry none. */
export function isUserGesture(event: { originalEvent?: unknown }): boolean {
  return event.originalEvent != null
}

/** A pan, zoom, rotate or pitch breaks out of following; overview stays put until resumed. */
export function stateAfterGesture(state: CameraState): CameraState {
  return state === 'following' ? 'free' : state
}
