/**
 * Shader programs that compile without stalling the main thread.
 *
 * Asking for a program's link status, or for a uniform location, makes the
 * driver finish compiling right there. `linkProgram` never asks; `programReady`
 * asks only once KHR_parallel_shader_compile says the work is done, so a layer
 * skips its draw for a frame or two instead of blocking the first one.
 */

export function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string, attribs: Record<string, number> = {}): WebGLProgram {
  const program = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
    gl.deleteShader(shader)
  }
  for (const [name, location] of Object.entries(attribs)) gl.bindAttribLocation(program, location, name)
  gl.linkProgram(program)
  return program
}

const settled = new WeakSet<WebGLProgram>()

/** Whether `program` has finished linking; a failed link is logged once and counts as settled. */
export function programReady(gl: WebGL2RenderingContext, program: WebGLProgram, label = 'shader'): boolean {
  if (settled.has(program)) return true
  const parallel = gl.getExtension('KHR_parallel_shader_compile')
  if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) return false
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error(`[${label}] link:`, gl.getProgramInfoLog(program))
  settled.add(program)
  return true
}

export type Uniforms<N extends string> = Record<N, WebGLUniformLocation | null>

/** A program compiled on its first use, with its uniforms looked up once it has linked. */
export class LazyProgram<N extends string = string> {
  private program: WebGLProgram | null = null
  private linked: { program: WebGLProgram; u: Uniforms<N> } | null = null

  constructor(
    private readonly vs: string,
    private readonly fs: string,
    private readonly uniforms: readonly N[],
    private readonly label: string,
    private readonly attribs: Record<string, number> = {},
  ) {}

  /** Start compiling, so the program is likelier ready by the time it is drawn with. */
  start(gl: WebGL2RenderingContext) {
    this.program ??= linkProgram(gl, this.vs, this.fs, this.attribs)
  }

  /** The program and its uniforms, or null while it is still compiling. */
  use(gl: WebGL2RenderingContext): { program: WebGLProgram; u: Uniforms<N> } | null {
    if (this.linked) return this.linked
    this.start(gl)
    if (!programReady(gl, this.program!, this.label)) return null
    const u = Object.fromEntries(this.uniforms.map(name => [name, gl.getUniformLocation(this.program!, name)])) as Uniforms<N>
    this.linked = { program: this.program!, u }
    return this.linked
  }

  delete(gl: WebGL2RenderingContext) {
    if (this.program) gl.deleteProgram(this.program)
    this.program = null
    this.linked = null
  }
}
