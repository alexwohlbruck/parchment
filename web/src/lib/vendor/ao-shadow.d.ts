/**
 * Minimal typings for the vendored shadow layer. It is plain JS by design —
 * kept byte-close to upstream so it stays updatable — so the surface we
 * actually call is declared here rather than by annotating the file itself.
 */
export interface WallShadowLayerOptions {
  id?: string
  buildingsLayerId: string
  sourceId?: string | null
  minZoom?: number
  maxZoom?: number
  enabled?: boolean
  wallShade?: boolean
  groundFx?: boolean
  strength?: number
  band?: number
  shadowAlpha?: number
  heightScale?: number
  shadowOffset?: [number, number]
  shadowBlur?: number
  sdfResolution?: number
  aoRadiusMin?: number
  aoRadiusMax?: number
  aoIntensity?: number
  aoOffset?: [number, number, number]
  edge?: number
  edgeWidth?: number
  /** Drawn into the cast-shadow mask with the buildings; see `_casterShadows`. */
  shadowCasters?: Set<{
    drawShadow(gl: WebGL2RenderingContext, frame: { matrix: ArrayLike<number>; shear: [number, number] }): void
  }>
}

export class WallShadowLayer {
  constructor(options: WallShadowLayerOptions)
  readonly id: string
  readonly type: 'custom'
  readonly renderingMode: '2d' | '3d'
  enabled: boolean
  wallShade: boolean
  groundFx: boolean
  onAdd(map: any, gl: WebGL2RenderingContext): void
  onRemove(map: any, gl: WebGL2RenderingContext): void
  render(gl: WebGL2RenderingContext, args?: unknown): void
}
