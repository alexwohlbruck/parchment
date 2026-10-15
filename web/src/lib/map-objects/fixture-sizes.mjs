/**
 * The real sizes of the signals and crossing gear, in metres, shared by the
 * script that builds their models and the layer that scales them back up.
 */
export const LANE_WIDTH = 3.4
export const SIGNAL_POLE = 7.2
export const GATE_PIVOT = 1.3
export const CROSSING_POLE = 4.3
export const CROSSBUCK_POST = 3
/** The bell on top of a crossing's post. */
export const BELL = 0.2

/** A gate arm's length over `lanes`, up to the longest built. */
export const gateArm = lanes => Math.min(11, lanes * LANE_WIDTH + 0.8)

/** Each model's height, which the build fits to one unit and the layer scales back by. */
export const FIXTURE_HEIGHTS = {
  'signal-1': SIGNAL_POLE,
  'signal-2': SIGNAL_POLE,
  'signal-3': SIGNAL_POLE,
  'signal-4': SIGNAL_POLE,
  'crossing-gate-1': GATE_PIVOT + gateArm(1),
  'crossing-gate-2': GATE_PIVOT + gateArm(2),
  'crossing-gate-3': GATE_PIVOT + gateArm(3),
  'crossing-lights': CROSSING_POLE + BELL,
  crossbuck: CROSSBUCK_POST,
}
