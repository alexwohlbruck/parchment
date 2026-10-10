/**
 * The flat-shaded, sun-lit program decks and tunnels draw with, and the
 * buffers a built mesh is uploaded into.
 */
import type { Mesh } from './decks'

const VS = `
  uniform mat4 u_matrix;
  uniform vec3 u_light;
  attribute vec3 a_position;
  attribute vec3 a_normal;
  attribute vec3 a_color;
  varying vec3 v_color;
  void main() {
    float sun = dot(normalize(a_normal), u_light) * 0.5 + 0.5;
    float sky = normalize(a_normal).z * 0.5 + 0.5;
    v_color = a_color * mix(0.62, 1.0, mix(sun, sky, 0.6));
    gl_Position = u_matrix * vec4(a_position, 1.0);
  }`

const FS = `
  precision mediump float;
  varying vec3 v_color;
  void main() { gl_FragColor = vec4(v_color, 1.0); }`

export type MeshBuffers = { position: WebGLBuffer; normal: WebGLBuffer; color: WebGLBuffer; count: number }

export function linkMeshProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error('[mesh] link:', gl.getProgramInfoLog(program))
  return program
}

export function uploadMesh(gl: WebGL2RenderingContext, mesh: Mesh): MeshBuffers {
  const upload = (data: number[]) => {
    const buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
    return buffer
  }
  return { position: upload(mesh.position), normal: upload(mesh.normal), color: upload(mesh.color), count: mesh.position.length / 3 }
}

export function deleteMesh(gl: WebGL2RenderingContext, buffers: MeshBuffers | null) {
  if (buffers) for (const b of [buffers.position, buffers.normal, buffers.color]) gl.deleteBuffer(b)
}

/**
 * Bind the program with its matrix and the style's light, and the buffers to
 * its attributes; returns a draw for a range of vertices and an unbind.
 */
const locations = new WeakMap<WebGLProgram, { matrix: WebGLUniformLocation | null; light: WebGLUniformLocation | null; attributes: number[] }>()

export function bindMesh(gl: WebGL2RenderingContext, program: WebGLProgram, buffers: MeshBuffers, matrix: Float32Array, light: number[]) {
  let at = locations.get(program)
  if (!at) {
    at = { matrix: gl.getUniformLocation(program, 'u_matrix'), light: gl.getUniformLocation(program, 'u_light'), attributes: ['a_position', 'a_normal', 'a_color'].map(name => gl.getAttribLocation(program, name)) }
    locations.set(program, at)
  }
  gl.useProgram(program)
  gl.uniformMatrix4fv(at.matrix, false, matrix)
  const l = Math.hypot(light[0], light[1], light[2]) || 1
  gl.uniform3f(at.light, light[0] / l, light[1] / l, light[2] / l)
  gl.bindVertexArray(null)
  const attributes = at.attributes
  const locs = [buffers.position, buffers.normal, buffers.color].map((buffer, k) => {
    const loc = attributes[k]
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0)
    return loc
  })
  return {
    draw: (from = 0, to = buffers.count) => {
      if (to > from) gl.drawArrays(gl.TRIANGLES, from, to - from)
    },
    unbind: () => {
      for (const loc of locs) gl.disableVertexAttribArray(loc)
    },
  }
}
