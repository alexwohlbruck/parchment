import { ATMOSPHERE_GLSL } from './atmosphere'
import { GlobeTexture } from './globe-texture'
import { Exposure, meterExposure } from './exposure'
import { galacticRotation } from './celestial'
import { DAYNIGHT_LAYER_ID, globeSunDirection } from '@/lib/daynight/daynight'
import type { CustomLayerInterface, CustomRenderMethodInput, Map } from 'maplibre-gl'

const nightLightsUrl = new URL('../../assets/map-globe/night-lights.webp', import.meta.url).href
const transmittanceUrl = new URL('../../assets/map-globe/transmittance.png', import.meta.url).href
const milkyWayUrl = new URL('../../assets/map-globe/milky-way.webp', import.meta.url).href

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
uniform vec3 u_sun;
uniform float u_lighting;
uniform float u_night_brightness;
uniform sampler2D u_night_lights;
uniform sampler2D u_milky_way;
uniform mat3 u_galactic;
uniform float u_galaxy_blend;
uniform float u_exposure;
uniform sampler2D u_transmittance;
uniform float u_atmosphere_blend;
out vec4 fragColor;
${ATMOSPHERE_GLSL}
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
vec3 sunGlow(vec3 ray) {
    float angle = acos(clamp(dot(ray, u_sun), -1.0, 1.0));
    float antialias = max(fwidth(angle), 0.0001);
    float disc = 1.0 - smoothstep(0.00465 - antialias, 0.00465 + antialias, angle);
    float corona = exp(-angle / 0.014) * 0.7;
    float bloom = exp(-pow(angle / 0.065, 1.4)) * 0.16;
    return vec3(1.0, 0.96, 0.82) * disc
        + vec3(1.0, 0.65, 0.26) * corona
        + vec3(1.0, 0.50, 0.16) * bloom;
}

void main() {
    vec3 ray = normalize(v_far - v_near);
    float along = max(0.0, -dot(v_near, ray));
    float distanceToCenter = length(v_near + ray * along);
    float edge = distanceToCenter - 1.0;
    float pixel = max(fwidth(distanceToCenter), 0.00001);
    float outside = smoothstep(-pixel, pixel, edge);
    vec3 tangent = normalize(v_near + ray * along);
    vec3 surface = normalize(v_near + ray * (along - sqrt(max(0.0, 1.0 - distanceToCenter * distanceToCenter))));
    float sunHeight = dot(surface, u_sun);
    float daylight = smoothstep(-0.12, 0.16, sunHeight);
    float direct = pow(max(sunHeight, 0.0), 0.45);
    float brightness = u_night_brightness + (1.0 - u_night_brightness) * daylight * (0.32 + 0.68 * direct);
    float shadow = (1.0 - min(1.0, brightness * u_exposure)) * u_lighting;
    float limbSun = dot(tangent, u_sun);
    float scatter = mix(1.0, 0.12 + 0.88 * smoothstep(-0.22, 0.25, limbSun), u_lighting);
    float outerHaze = exp(-max(edge, 0.0) / 0.035) * 0.65;
    float outerRim = exp(-max(edge, 0.0) / 0.005) * 0.35;
    float innerHaze = exp(-sqrt(max(0.0, 1.0 - distanceToCenter * distanceToCenter)) * 5.0) * 0.6;
    vec3 blue = vec3(0.30, 0.59, 1.0);
    vec3 rim = vec3(0.70, 0.85, 1.0);
    float sunset = exp(-pow(limbSun / 0.13, 2.0)) * u_lighting;
    vec3 atmosphereColor = mix(blue, vec3(0.95, 0.40, 0.16), sunset * 0.5);
    float atmosphereExposure = sqrt(u_exposure);
    vec3 galactic = u_galactic * ray;
    vec2 skyUv = vec2(0.5 - atan(galactic.y, galactic.x) / 6.28318530718, 0.5 - asin(clamp(galactic.z, -1.0, 1.0)) / 3.14159265359);
    vec3 galaxy = pow(max(texture(u_milky_way, skyUv).rgb - vec3(0.04), vec3(0.0)), vec3(1.35));
    vec3 spaceColor = (atmosphereColor * outerHaze + rim * outerRim) * scatter * atmosphereExposure;
    spaceColor += galaxy * u_galaxy_blend * (0.06 + 0.045 * (u_exposure - 1.0));
    spaceColor += sunGlow(ray);
    spaceColor += vec3(0.86, 0.91, 1.0) * stars(galactic) * (1.0 - min(1.0, outerHaze * scatter)) * mix(1.0, 0.6, u_galaxy_blend) * atmosphereExposure;
    float hazeAlpha = min(0.8, innerHaze * scatter * atmosphereExposure * 0.55);
    vec3 surfaceColor = atmosphereColor * innerHaze * scatter * atmosphereExposure + vec3(0.004, 0.008, 0.02) * shadow;
    vec3 transmission = vec3(1.0);
    float daylightHaze = mix(1.0, smoothstep(-0.02, 0.12, sunHeight), u_lighting) * u_atmosphere_blend;
    if (distanceToCenter < 1.0 && daylightHaze > 0.0) {
        float groundDistance = along - sqrt(max(0.0, 1.0 - distanceToCenter * distanceToCenter));
        vec3 atmosphereSun = normalize(mix(-ray, u_sun, u_lighting));
        Atmosphere atmosphere = scatterAtmosphere(v_near, ray, atmosphereSun, groundDistance);
        transmission = mix(vec3(1.0), atmosphere.transmission, daylightHaze);
        vec3 daylightColor = pow(1.0 - exp(-atmosphere.radiance * 8.0 * atmosphereExposure), vec3(1.0 / 2.2));
        surfaceColor = mix(surfaceColor, daylightColor * 0.35 + vec3(0.004, 0.008, 0.02) * shadow, daylightHaze);
        hazeAlpha = mix(hazeAlpha, 1.0 - dot(atmosphere.transmission, vec3(0.2126, 0.7152, 0.0722)), daylightHaze);
    }
    vec2 lightsUv = vec2(atan(surface.x, surface.z) / 6.28318530718 + 0.5, 0.5 - asin(surface.y) / 3.14159265359);
    float radiance = texture(u_night_lights, lightsUv).r;
    float lights = pow(max(0.0, radiance - 0.025), 1.25);
    float night = (1.0 - smoothstep(-0.16, 0.02, sunHeight)) * u_lighting;
    vec3 cityColor = mix(vec3(1.0, 0.46, 0.12), vec3(1.0, 0.90, 0.62), smoothstep(0.25, 0.8, lights));
    surfaceColor += (vec3(1.0) - exp(-cityColor * lights * night * 1.8 * atmosphereExposure)) * transmission;
    vec3 color = mix(surfaceColor, spaceColor, outside);
    float alpha = mix(shadow + hazeAlpha * (1.0 - shadow), 1.0, outside) * u_opacity;
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
  private sun?: WebGLUniformLocation | null
  private lighting?: WebGLUniformLocation | null
  private nightBrightness?: WebGLUniformLocation | null
  private lightsSampler?: WebGLUniformLocation | null
  private lights = new GlobeTexture(nightLightsUrl, { singleChannel: true })
  private galaxy = new GlobeTexture(milkyWayUrl)
  private atmosphere = new GlobeTexture(transmittanceUrl, { clamp: true })
  private transmittanceSampler?: WebGLUniformLocation | null
  private atmosphereBlend?: WebGLUniformLocation | null
  private exposure = new Exposure()
  private milkyWaySampler?: WebGLUniformLocation | null
  private galactic?: WebGLUniformLocation | null
  private galaxyBlend?: WebGLUniformLocation | null
  private exposureUniform?: WebGLUniformLocation | null

  constructor(private readonly satellite: () => boolean = () => false) {}

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
    this.sun = gl.getUniformLocation(program, 'u_sun')
    this.lighting = gl.getUniformLocation(program, 'u_lighting')
    this.nightBrightness = gl.getUniformLocation(program, 'u_night_brightness')
    this.lightsSampler = gl.getUniformLocation(program, 'u_night_lights')
    this.milkyWaySampler = gl.getUniformLocation(program, 'u_milky_way')
    this.galactic = gl.getUniformLocation(program, 'u_galactic')
    this.galaxyBlend = gl.getUniformLocation(program, 'u_galaxy_blend')
    this.exposureUniform = gl.getUniformLocation(program, 'u_exposure')
    this.transmittanceSampler = gl.getUniformLocation(program, 'u_transmittance')
    this.atmosphereBlend = gl.getUniformLocation(program, 'u_atmosphere_blend')
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
    const inverseMatrix = inverse.toFloat32Array()
    gl.uniformMatrix4fv(this.inverse!, false, inverseMatrix)
    const dayNight = this.map.getLayer(DAYNIGHT_LAYER_ID)
    const lighting = !!dayNight && this.map.getLayoutProperty(DAYNIGHT_LAYER_ID, 'visibility') !== 'none'
    const date = new Date()
    const sun = globeSunDirection(date)
    const targetExposure = lighting ? meterExposure(inverseMatrix, sun) : 1
    gl.uniform1f(this.exposureUniform!, this.exposure.update(targetExposure, performance.now()))
    this.atmosphere.load(() => this.map?.triggerRepaint())
    this.atmosphere.bind(gl, 2)
    gl.uniform1i(this.transmittanceSampler!, 2)
    gl.uniform1f(this.atmosphereBlend!, this.atmosphere.blend)
    this.galaxy.load(() => this.map?.triggerRepaint())
    this.galaxy.bind(gl, 1)
    gl.uniform1i(this.milkyWaySampler!, 1)
    gl.uniformMatrix3fv(this.galactic!, false, galacticRotation(date))
    gl.uniform1f(this.galaxyBlend!, this.galaxy.blend)
    if (!this.exposure.settled || (this.galaxy.ready && this.galaxy.blend < 1) || (this.atmosphere.ready && this.atmosphere.blend < 1)) this.map.triggerRepaint()
    if (lighting) this.lights.load(() => this.map?.triggerRepaint())
    this.lights.bind(gl)
    gl.uniform1i(this.lightsSampler!, 0)
    gl.uniform3fv(this.sun!, sun)
    gl.uniform1f(this.lighting!, lighting ? 1 : 0)
    gl.uniform1f(this.nightBrightness!, this.satellite() ? 0.09 : 0.18)
    gl.uniform1f(this.pixelRatio!, this.map.getPixelRatio())
    gl.uniform1f(this.opacity!, fade * fade * (3 - 2 * fade))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  onRemove(_map: Map, context: WebGLRenderingContext | WebGL2RenderingContext) {
    const gl = context as WebGL2RenderingContext
    this.lights.dispose(gl)
    this.galaxy.dispose(gl)
    this.atmosphere.dispose(gl)
    this.exposure = new Exposure()
    if (this.program) gl.deleteProgram(this.program)
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.program = undefined
    this.vao = undefined
    this.map = undefined
  }
}
