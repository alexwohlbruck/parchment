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
}

export type GlbModel = {
  primitives: GlbPrimitive[]
  /** Axis-aligned bounds, in the model's own units. */
  min: [number, number, number]
  max: [number, number, number]
}

export declare function parseGlb(buffer: ArrayBuffer): GlbModel
export declare function loadGlb(url: string): Promise<GlbModel>
