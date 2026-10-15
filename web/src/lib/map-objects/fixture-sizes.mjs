/**
 * The real sizes of the signals and crossing gear, in metres, shared by the
 * script that builds their models and the layer that scales them back up.
 * Sources are given where each is used in `scripts/build-3d-objects.mjs`.
 */
export const LANE_WIDTH = 3.4
/** Mast arm pole to its cap; the arm meets it at `SIGNAL_ARM`. */
export const SIGNAL_POLE = 7.0
export const SIGNAL_ARM = 6.4
/** A crossing's flasher mast to the top of its bell. */
export const CROSSING_POLE = 4.2
export const CROSSBUCK_POST = 3.9
/** Where a gate arm turns, beside the mast. */
export const GATE_PIVOT = 1.9

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
  'crossing-lights': CROSSING_POLE,
  crossbuck: CROSSBUCK_POST,
}
