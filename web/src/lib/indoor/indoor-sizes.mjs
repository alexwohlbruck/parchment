/** A floor plan's heights in metres, shared by its style and the models that stand on it. */
export const FLOOR_HEIGHT = 0.3
export const WALL_HEIGHT = 3.5
/** How far a flight climbs: from the floor to the top of the walls, where the floor above would be. */
export const FLIGHT_RISE = WALL_HEIGHT - FLOOR_HEIGHT
/** Where a flight's treads meet at its middle, which the layer tilts it about. */
export const FLIGHT_MIDDLE = FLOOR_HEIGHT + FLIGHT_RISE / 2
/** A flight model's height: its middle tread and the handrail above it. */
export const FLIGHT_MODEL_HEIGHT = FLIGHT_MIDDLE + 0.98
