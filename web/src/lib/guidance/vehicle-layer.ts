// The navigation puck drawn as a 3D vehicle: a MapLibre custom layer holding
// one model, posed every frame from a caller-supplied reader.

import type { CustomLayerInterface, Map as MaplibreMap } from 'maplibre-gl'
import { hexToLinear, vehicleScale, type VehicleModel } from './vehicle-indicator'
import { vehicleMesh, VERTEX_FLOATS, type VehicleMesh } from './vehicle-models'

export interface VehiclePose {
  lng: number
  lat: number
  /** Degrees clockwise from north. */
  bearing: number
  /** Metres above sea level, the same datum as the terrain. */
  elevation: number
}

export const VEHICLE_LAYER_ID = 'guidance-vehicle'

const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8
const LIGHT = normalize([-0.35, 0.45, 0.82])
const AMBIENT = 0.5
const SHADOW_SPREAD = 1.25

const LOC = { a_position: 0, a_normal: 1, a_color: 2, a_paint: 3 }

const VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform vec3 u_frame;
  uniform vec3 u_paint;
  uniform vec3 u_light;
  layout(location = 0) in vec3 a_position;
  layout(location = 1) in vec3 a_normal;
  layout(location = 2) in vec3 a_color;
  layout(location = 3) in float a_paint;
  out vec3 v_color;
  void main() {
    float c = u_frame.x, s = u_frame.y, k = u_frame.z;
    vec3 p = a_position;
    vec3 n = vec3(a_normal.x * c + a_normal.y * s, -a_normal.x * s + a_normal.y * c, a_normal.z);
    float sun = dot(n, u_light) * 0.5 + 0.5;
    float sky = n.z * 0.5 + 0.5;
    vec3 base = mix(a_color, u_paint, a_paint);
    v_color = base * mix(${AMBIENT.toFixed(2)}, 1.0, mix(sun, sky, 0.45));
    gl_Position = u_matrix * vec4((p.x * c + p.y * s) * k, (p.x * s - p.y * c) * k, p.z * k, 1.0);
  }`

const FS = `#version 300 es
  precision mediump float;
  in vec3 v_color;
  out vec4 color;
  void main() { color = vec4(pow(v_color, vec3(1.0 / 2.2)), 1.0); }`

const SHADOW_VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform vec3 u_frame;
  uniform vec2 u_size;
  layout(location = 0) in vec2 a_corner;
  out vec2 v_uv;
  void main() {
    float c = u_frame.x, s = u_frame.y, k = u_frame.z;
    vec2 p = a_corner * u_size;
    v_uv = a_corner;
    gl_Position = u_matrix * vec4((p.x * c + p.y * s) * k, (p.x * s - p.y * c) * k, 0.0, 1.0);
  }`

const SHADOW_FS = `#version 300 es
  precision mediump float;
  in vec2 v_uv;
  out vec4 color;
  void main() {
    float a = 0.34 * (1.0 - smoothstep(0.45, 1.0, length(v_uv)));
    color = vec4(0.0, 0.0, 0.0, a);
  }`

const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1])

interface Programs {
  model: WebGLProgram
  shadow: WebGLProgram
  modelVao: WebGLVertexArrayObject
  shadowVao: WebGLVertexArrayObject
  modelBuffer: WebGLBuffer
  shadowBuffer: WebGLBuffer
  u: Record<'matrix' | 'frame' | 'paint' | 'light' | 'shadowMatrix' | 'shadowFrame' | 'shadowSize', WebGLUniformLocation | null>
}

export class VehicleLayer implements CustomLayerInterface {
  readonly id = VEHICLE_LAYER_ID
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const

  private map: MaplibreMap | null = null
  private gl: Programs | null = null
  private model: VehicleModel | null = null
  private mesh: VehicleMesh | null = null
  private uploaded: VehicleMesh | null = null
  private readonly paint = new Float32Array(3)
  private readonly pose: VehiclePose = { lng: 0, lat: 0, bearing: 0, elevation: 0 }
  private readonly matrix = new Float32Array(16)
  private readonly frame = new Float32Array(3)

  constructor(private readonly readPose: (out: VehiclePose) => boolean) {}

  setVehicle(model: VehicleModel | null, color: string) {
    this.model = model
    this.mesh = model ? vehicleMesh(model) : null
    this.paint.set(hexToLinear(color))
    this.map?.triggerRepaint()
  }

  onAdd(map: MaplibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    const model = link(gl, VS, FS)
    const shadow = link(gl, SHADOW_VS, SHADOW_FS)
    const modelBuffer = gl.createBuffer()!
    const shadowBuffer = gl.createBuffer()!
    const modelVao = gl.createVertexArray()!
    gl.bindVertexArray(modelVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffer)
    const stride = VERTEX_FLOATS * 4
    gl.enableVertexAttribArray(LOC.a_position)
    gl.vertexAttribPointer(LOC.a_position, 3, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(LOC.a_normal)
    gl.vertexAttribPointer(LOC.a_normal, 3, gl.FLOAT, false, stride, 12)
    gl.enableVertexAttribArray(LOC.a_color)
    gl.vertexAttribPointer(LOC.a_color, 3, gl.FLOAT, false, stride, 24)
    gl.enableVertexAttribArray(LOC.a_paint)
    gl.vertexAttribPointer(LOC.a_paint, 1, gl.FLOAT, false, stride, 36)
    const shadowVao = gl.createVertexArray()!
    gl.bindVertexArray(shadowVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    const at = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name)
    this.gl = {
      model,
      shadow,
      modelVao,
      shadowVao,
      modelBuffer,
      shadowBuffer,
      u: {
        matrix: at(model, 'u_matrix'),
        frame: at(model, 'u_frame'),
        paint: at(model, 'u_paint'),
        light: at(model, 'u_light'),
        shadowMatrix: at(shadow, 'u_matrix'),
        shadowFrame: at(shadow, 'u_frame'),
        shadowSize: at(shadow, 'u_size'),
      },
    }
    this.uploaded = null
  }

  onRemove(_map: MaplibreMap, gl: WebGL2RenderingContext) {
    const programs = this.gl
    if (programs) {
      gl.deleteProgram(programs.model)
      gl.deleteProgram(programs.shadow)
      gl.deleteBuffer(programs.modelBuffer)
      gl.deleteBuffer(programs.shadowBuffer)
      gl.deleteVertexArray(programs.modelVao)
      gl.deleteVertexArray(programs.shadowVao)
    }
    this.gl = null
    this.uploaded = null
    this.map = null
  }

  render(gl: WebGL2RenderingContext, args: unknown) {
    const programs = this.gl
    const mesh = this.mesh
    const map = this.map
    if (!programs || !mesh || !this.model || !map || !this.readPose(this.pose)) return

    const pose = this.pose
    const perMetre = 1 / (EARTH_CIRCUMFERENCE * Math.cos((pose.lat * Math.PI) / 180))
    const scale = vehicleScale(this.model, mesh.length, map.getZoom(), pose.lat)
    const heading = (pose.bearing * Math.PI) / 180
    this.frame[0] = Math.cos(heading)
    this.frame[1] = Math.sin(heading)
    this.frame[2] = perMetre * scale
    const x = (180 + pose.lng) / 360
    const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (pose.lat * Math.PI) / 360))) / 360
    translateInto(this.matrix, projectionOf(args), x, y, pose.elevation * perMetre)

    if (this.uploaded !== mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, programs.modelBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW)
      this.uploaded = mesh
    }

    // The puck stays visible through overpasses and buildings, as navigation pucks do.
    gl.depthMask(true)
    gl.clearDepth(1)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthRange(0, 1)

    gl.depthMask(false)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(programs.shadow)
    gl.uniformMatrix4fv(programs.u.shadowMatrix, false, this.matrix)
    gl.uniform3fv(programs.u.shadowFrame, this.frame)
    gl.uniform2f(programs.u.shadowSize, (mesh.width / 2) * SHADOW_SPREAD, (mesh.length / 2) * SHADOW_SPREAD)
    gl.bindVertexArray(programs.shadowVao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.useProgram(programs.model)
    gl.uniformMatrix4fv(programs.u.matrix, false, this.matrix)
    gl.uniform3fv(programs.u.frame, this.frame)
    gl.uniform3fv(programs.u.paint, this.paint)
    gl.uniform3fv(programs.u.light, LIGHT)
    gl.bindVertexArray(programs.modelVao)
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
    gl.bindVertexArray(null)

    const context = (map as unknown as { painter?: { context?: Record<string, { dirty: boolean } | undefined> } }).painter?.context
    if (context)
      for (const key of ['program', 'bindVertexBuffer', 'bindVertexArray', 'depthMask', 'depthFunc', 'depthRange', 'depthTest', 'blend', 'blendFunc', 'cullFace', 'stencilTest', 'clearDepth'])
        if (context[key]) context[key]!.dirty = true
  }
}

function projectionOf(args: unknown): ArrayLike<number> {
  const a = args as { defaultProjectionData?: { mainMatrix: ArrayLike<number> }; modelViewProjectionMatrix?: ArrayLike<number> }
  return a.defaultProjectionData?.mainMatrix ?? a.modelViewProjectionMatrix ?? (args as ArrayLike<number>)
}

/** `out` = `matrix` translated to (x, y, z), done in doubles so the puck does not shimmer at street zoom. */
function translateInto(out: Float32Array, matrix: ArrayLike<number>, x: number, y: number, z: number) {
  for (let i = 0; i < 12; i++) out[i] = matrix[i]
  for (let i = 0; i < 4; i++) out[12 + i] = matrix[i] * x + matrix[4 + i] * y + matrix[8 + i] * z + matrix[12 + i]
}

function normalize(v: number[]): Float32Array {
  const len = Math.hypot(...v)
  return new Float32Array(v.map(c => c / len))
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error('[vehicle] shader:', gl.getShaderInfoLog(shader))
    gl.attachShader(program, shader)
    gl.deleteShader(shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error('[vehicle] link:', gl.getProgramInfoLog(program))
  return program
}
