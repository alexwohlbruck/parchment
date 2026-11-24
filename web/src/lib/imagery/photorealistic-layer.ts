import { Camera, Matrix4, Raycaster, Scene, Vector3, WebGLRenderer } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { TilesRenderer, WGS84_ELLIPSOID } from '3d-tiles-renderer/three'
import {
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  TileCompressionPlugin,
  UnloadTilesPlugin,
} from '3d-tiles-renderer/plugins'
import { LngLat, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MaplibreMap } from 'maplibre-gl'
import { enuToMercator, splitViewProjection } from './photorealistic-camera'

export const PHOTOREALISTIC_LAYER_ID = 'imagery-3d'

/** The globe is round below this, and the tiles would be spent on a planet-sized view. */
const MIN_ZOOM = 12
/** How far the map centre may drift from the frame's origin before the frame moves with it. */
const REANCHOR_METRES = 2000
/** Frames between re-measuring the mesh's ground, which sharpens as finer tiles arrive. */
const GROUND_EVERY = 30
const RAY_HEIGHT = 20_000
const DOWN = new Vector3(0, 0, -1)
/** East and north offsets, in metres, of the rays that find the ground. */
const GROUND_SAMPLES = [-150, 0, 150]
/** Mesh heights are above the ellipsoid; the geoid strays from it by at most about this. */
const MAX_GROUND_OFFSET = 150

export interface PhotorealisticOptions {
  /** The root tileset, through our proxy. */
  url: string
  /** The map's own ground at a point: terrain height where terrain is on, otherwise sea level. */
  groundAt: (lng: number, lat: number) => number
  onCredits: (credits: string | null) => void
}

/**
 * Photorealistic 3D Tiles drawn into the MapLibre scene with three.js.
 *
 * The tiles are earth-centred; the scene is a local east-north-up frame in
 * metres around the map centre, moved along as the map pans. MapLibre's
 * matrix is split into a camera in that frame so the renderer can choose a
 * level of detail by screen-space error. The mesh carries ellipsoid heights,
 * so it is shifted until its ground meets the map's at the centre — which
 * absorbs the geoid and whether terrain is on in one measurement.
 */
export class PhotorealisticLayer implements CustomLayerInterface {
  readonly id = PHOTOREALISTIC_LAYER_ID
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const

  private map: MaplibreMap | null = null
  private renderer: WebGLRenderer | null = null
  private tiles: TilesRenderer | null = null
  private readonly scene = new Scene()
  private readonly camera = new Camera()
  private readonly raycaster = new Raycaster()
  private origin = { lng: 0, lat: 0 }
  private groundOffset = 0
  private frame = 0
  private credits: string | null = null

  constructor(private readonly options: PhotorealisticOptions) {}

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    const renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext })
    renderer.autoClear = false
    this.renderer = renderer

    const tiles = new TilesRenderer(this.options.url)
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: 'proxy', autoRefreshToken: true }))
    tiles.registerPlugin(new ProxyPathsPlugin(this.options.url))
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: dracoLoader() }))
    tiles.registerPlugin(new TileCompressionPlugin())
    tiles.registerPlugin(new UnloadTilesPlugin())
    tiles.group.matrixAutoUpdate = false
    // Each of these leaves work for the next update, which only a frame runs.
    for (const type of ['needs-update', 'load-root-tileset', 'load-tileset', 'load-model', 'dispose-model'] as const) {
      tiles.addEventListener(type, () => map.triggerRepaint())
    }
    tiles.setCamera(this.camera)
    this.scene.add(tiles.group)
    this.tiles = tiles

    this.anchor(map.getCenter())
    // The view comes from MapLibre every frame; three would otherwise rebuild it from an identity pose.
    this.camera.matrixAutoUpdate = false
    this.camera.matrixWorldAutoUpdate = false
    // Read by the tiles' own raycast, which can then stop at the first triangle.
    Object.assign(this.raycaster, { firstHitOnly: true })
  }

  onRemove() {
    this.tiles?.dispose()
    this.tiles = null
    this.renderer = null
    this.map = null
    this.setCredits(null)
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const { map, renderer, tiles } = this
    if (!map || !renderer || !tiles) return
    if (map.getZoom() < MIN_ZOOM) {
      this.setCredits(null)
      return
    }

    const center = map.getCenter()
    if (center.distanceTo(new LngLat(this.origin.lng, this.origin.lat)) > REANCHOR_METRES) {
      this.anchor(center)
    }
    if (this.frame++ % GROUND_EVERY === 0) this.measureGround()

    const { view, projection } = splitViewProjection(
      args.projectionMatrix as unknown as number[],
      // The Mercator matrix the other model layers read; `modelViewProjectionMatrix` is not in Mercator units here.
      (args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix) as unknown as number[],
      enuToMercator(this.origin.lng, this.origin.lat, this.groundOffset),
    )
    this.camera.matrixWorldInverse.fromArray(view)
    this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert()
    this.camera.projectionMatrix.fromArray(projection)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()

    const canvas = map.getCanvas()
    tiles.setResolution(this.camera, canvas.clientWidth, canvas.clientHeight)
    tiles.update()

    renderer.resetState()
    renderer.render(this.scene, this.camera)
    // Labels are drawn after the mesh; without this a tower would cut through them.
    renderer.clearDepth()

    this.setCredits(creditsOf(tiles))
    if (tiles.loadProgress < 1) map.triggerRepaint()
  }

  /** Centre the local frame on `center`, at the ellipsoid's surface. */
  private anchor(center: { lng: number; lat: number }) {
    this.origin = { lng: center.lng, lat: center.lat }
    const enuToEcef = WGS84_ELLIPSOID.getEastNorthUpFrame(
      (center.lat * Math.PI) / 180,
      (center.lng * Math.PI) / 180,
      0,
      new Matrix4(),
    )
    this.tiles!.group.matrix.copy(enuToEcef).invert()
    this.tiles!.group.updateMatrixWorld(true)
    this.frame = 0
  }

  /**
   * Line the mesh's ground up with the map's around the origin. The lowest of
   * a few rays is the street, not a roof; an answer further out than the geoid
   * ever is comes from a coarse tile, which cuts far under the curved surface,
   * and is ignored until finer ones load.
   */
  private measureGround() {
    const tiles = this.tiles!
    let lowest = Infinity
    for (const east of GROUND_SAMPLES) {
      for (const north of GROUND_SAMPLES) {
        this.raycaster.set(new Vector3(east, north, RAY_HEIGHT), DOWN)
        const [hit] = this.raycaster.intersectObject(tiles.group, true)
        if (hit) lowest = Math.min(lowest, hit.point.z)
      }
    }
    if (lowest === Infinity) return
    const offset = this.options.groundAt(this.origin.lng, this.origin.lat) - lowest
    if (Math.abs(offset) <= MAX_GROUND_OFFSET) this.groundOffset = offset
  }

  private setCredits(credits: string | null) {
    if (credits === this.credits) return
    this.credits = credits
    this.options.onCredits(credits)
  }
}

function creditsOf(tiles: TilesRenderer): string | null {
  const text = tiles
    .getAttributions()
    .flatMap(a => (a.type === 'string' && a.value ? [String(a.value)] : []))
    .join('; ')
  return text || null
}

/**
 * Child tiles name absolute paths on Google's host, which resolve against our
 * API's origin; send them back through the proxy beside the root.
 */
class ProxyPathsPlugin {
  readonly name = 'PROXY_PATHS_PLUGIN'
  private readonly origin: string
  private readonly base: string

  constructor(rootUrl: string) {
    this.origin = new URL(rootUrl).origin
    this.base = rootUrl.slice(0, rootUrl.lastIndexOf('/') + 1)
  }

  preprocessURL(url: string) {
    return url.replace(`${this.origin}/v1/3dtiles/`, this.base)
  }
}

let draco: DRACOLoader | null = null

/** One decoder for every layer, served with the app. */
function dracoLoader() {
  draco ??= new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
  return draco
}
