/**
 * Row geometry, shared so the highlight band lands exactly on the row that
 * rests in it. Centring the band on the control instead would drift whenever
 * borders or padding changed the control's own height.
 */
export const ROW_HEIGHT = 40
export const VISIBLE_ROWS = 5

/** Distance from the top of a column to the row resting in the centre. */
export const CENTRE_OFFSET = (ROW_HEIGHT * (VISIBLE_ROWS - 1)) / 2
