export type GlbPrimitive = {
  position: Float32Array
  normal: Float32Array
  index: Uint16Array | Uint32Array
  /** Linear RGBA from the material's base colour factor. */
  color: [number, number, number, number]
  /** The material's name, which is how a primitive's role travels. */
  material: string
  /** `TEXCOORD_0`, when the primitive has one. */
  uv: Float32Array | null
  /** The base-colour texture's image, undecoded. */
  image: { bytes: Uint8Array; mimeType: string } | null
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND'
  alphaCutoff: number
  doubleSided: boolean
  /**
   * The moving node this primitive is drawn with, or -1. Its vertices are in
   * that node's frame; `poseGlb` gives the node's matrix at a moment.
   */
  node: number
}

export type GlbChannel = {
  node: number
  path: 'translation' | 'rotation' | 'scale'
  step: boolean
  /** Seconds. */
  times: Float32Array
  values: Float32Array
}

/** The first animation clip, when parsed with `{ animation: true }`. */
export type GlbAnimation = {
  /** Seconds in one loop. */
  duration: number
  nodes: Array<{
    parent: number
    matrix: number[] | null
    translation: number[]
    rotation: number[]
    scale: number[]
  }>
  channels: GlbChannel[]
  /** The nodes the clip moves. */
  joints: Set<number>
}

export type GlbModel = {
  primitives: GlbPrimitive[]
  /** Axis-aligned bounds, in the model's own units. */
  min: [number, number, number]
  max: [number, number, number]
  /** Null unless asked for and present; see `parseGlb`. */
  animation: GlbAnimation | null
}

export declare function parseGlb(buffer: ArrayBuffer, options?: { animation?: boolean }): GlbModel
/** Moving nodes' matrices (column-major, to model space) `seconds` into the looped clip. */
export declare function poseGlb(model: Pick<GlbModel, 'animation'>, seconds: number): Map<number, Float32Array> | null
export declare function sampleChannel(channel: GlbChannel, t: number): number[]
export declare function loadGlb(url: string): Promise<GlbModel>
