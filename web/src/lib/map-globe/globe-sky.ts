import type { CustomLayerInterface, CustomRenderMethodInput, Map } from 'maplibre-gl'

const vertex = `#version 300 es
precision highp float;
uniform mat4 u_inverse;
out vec3 v_near;
out vec3 v_far;
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
    vec4 a = u_inverse * vec4(p, -1.0, 1.0);
    vec4 b = u_inverse * vec4(p, 0.0, 1.0);
    v_near = a.xyz / a.w;
    v_far = b.xyz / b.w;
    gl_Position = vec4(p, 0.0, 1.0);
}`

const fragment = `#version 300 es
precision highp float;
in vec3 v_near;
in vec3 v_far;
uniform float u_opacity;
uniform float u_pixel_ratio;
out vec4 fragColor;
vec3 hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yxz + 33.33);
    return fract((q.xxy + q.yzz) * q.zyx);
}
float stars(vec3 ray) {
    // Cube faces keep the star density even at the celestial poles.
    vec3 a = abs(ray);
    vec2 uv;
    float face;
    if (a.x > a.y && a.x > a.z) { uv = ray.yz / a.x; face = sign(ray.x); }
    else if (a.y > a.z) { uv = ray.xz / a.y; face = 3.0 * sign(ray.y); }
    else { uv = ray.xy / a.z; face = 5.0 * sign(ray.z); }
    vec2 grid = (uv + 1.0) * 180.0;
    vec2 cell = floor(grid);
    vec2 dx = dFdx(grid);
    vec2 dy = dFdy(grid);
    float determinant = dx.x * dy.y - dx.y * dy.x;
    float light = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = cell + vec2(x, y);
            vec3 seed = hash(neighbor + face * 731.0);
            if (seed.x < 0.986) continue;
            vec2 offset = grid - neighbor - (0.2 + seed.xy * 0.6);
            vec2 delta = vec2(dy.y * offset.x - dy.x * offset.y, dx.x * offset.y - dx.y * offset.x)
                / (determinant * u_pixel_ratio);
            float radius = mix(0.35, 0.9, pow(seed.z, 14.0));
            float core = exp(-dot(delta, delta) / (radius * radius));
            float glow = exp(-dot(delta, delta) / 3.0) * 0.07 * pow(seed.z, 12.0);
            light += (core + glow) * (0.2 + 0.65 * pow(seed.z, 5.0));
        }
    }
    return light;
}
void main() {
    vec3 ray = normalize(v_far - v_near);
    float along = max(0.0, -dot(v_near, ray));
    float distanceToCenter = length(v_near + ray * along);
    float edge = distanceToCenter - 1.0;
    float pixel = max(fwidth(distanceToCenter), 0.00001);
    float outside = smoothstep(-pixel, pixel, edge);
    float outerHaze = exp(-max(edge, 0.0) / 0.018) * 0.4;
    float outerRim = exp(-max(edge, 0.0) / 0.003) * 0.22;
    float innerHaze = pow(clamp(distanceToCenter, 0.0, 1.0), 38.0) * 0.25;
    float atmosphere = mix(innerHaze, outerHaze + outerRim, outside);
    vec3 blue = vec3(0.32, 0.60, 0.94);
    vec3 color = blue * atmosphere + vec3(0.86, 0.91, 1.0) * stars(ray) * outside * (1.0 - outerHaze);
    float alpha = mix(innerHaze * 0.6, 1.0, outside) * u_opacity;
    fragColor = vec4(color * u_opacity, alpha);
}`

function shader(gl: WebGL2RenderingContext, type: number, source: string) {
  const result = gl.createShader(type)!
  gl.shaderSource(result, source)
  gl.compileShader(result)
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(result)
    gl.deleteShader(result)
    throw new Error(`Globe sky shader: ${error}`)
  }
  return result
}

export class GlobeSky implements CustomLayerInterface {
  readonly id = 'globe-sky'
  readonly type = 'custom' as const
  readonly renderingMode = '2d' as const
  private map?: Map
  private program?: WebGLProgram
  private vao?: WebGLVertexArrayObject
  private inverse?: WebGLUniformLocation | null
  private opacity?: WebGLUniformLocation | null
  private pixelRatio?: WebGLUniformLocation | null

  onAdd(map: Map, context: WebGLRenderingContext | WebGL2RenderingContext) {
    const gl = context as WebGL2RenderingContext
    const program = gl.createProgram()!
    const shaders: WebGLShader[] = []
    try {
      shaders.push(shader(gl, gl.VERTEX_SHADER, vertex))
      shaders.push(shader(gl, gl.FRAGMENT_SHADER, fragment))
      for (const source of shaders) gl.attachShader(program, source)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Globe sky program: ${gl.getProgramInfoLog(program)}`)
      }
    } catch (error) {
      gl.deleteProgram(program)
      throw error
    } finally {
      for (const source of shaders) gl.deleteShader(source)
    }
    this.map = map
    this.program = program
    this.vao = gl.createVertexArray()!
    this.inverse = gl.getUniformLocation(program, 'u_inverse')
    this.opacity = gl.getUniformLocation(program, 'u_opacity')
    this.pixelRatio = gl.getUniformLocation(program, 'u_pixel_ratio')
  }

  render(context: WebGLRenderingContext | WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (!this.map || !this.program) return
    const zoom = this.map.getZoom()
    const transition = input.defaultProjectionData.projectionTransition
    if (transition < 0.999 || zoom >= 6) return
    const fade = 1 - Math.min(1, Math.max(0, (zoom - 4) / 2))
    const inverse = DOMMatrix.fromFloat32Array(new Float32Array(input.defaultProjectionData.mainMatrix)).inverse()
    const gl = context as WebGL2RenderingContext
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao!)
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.uniformMatrix4fv(this.inverse!, false, inverse.toFloat32Array())
    gl.uniform1f(this.pixelRatio!, this.map.getPixelRatio())
    gl.uniform1f(this.opacity!, fade * fade * (3 - 2 * fade))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  onRemove(_map: Map, context: WebGLRenderingContext | WebGL2RenderingContext) {
    const gl = context as WebGL2RenderingContext
    if (this.program) gl.deleteProgram(this.program)
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.program = undefined
    this.vao = undefined
    this.map = undefined
  }
}
