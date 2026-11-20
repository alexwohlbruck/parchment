import { expect, test, vi } from 'vitest'
import { LazyProgram, programReady } from './gl-program'

const COMPLETION = 1
const LINK = 2

function fakeGl(complete: () => boolean) {
  const getProgramParameter = vi.fn((_program: unknown, status: number) => (status === COMPLETION ? complete() : true))
  const gl = {
    VERTEX_SHADER: 10, FRAGMENT_SHADER: 11, LINK_STATUS: LINK,
    getExtension: () => ({ COMPLETION_STATUS_KHR: COMPLETION }),
    getProgramParameter,
    createProgram: vi.fn(() => ({})), createShader: () => ({}), shaderSource() {}, compileShader() {}, attachShader() {}, deleteShader() {},
    bindAttribLocation() {}, linkProgram() {}, deleteProgram() {}, getProgramInfoLog: () => '',
    getUniformLocation: vi.fn((_p: unknown, name: string) => ({ name })),
  }
  return { gl: gl as unknown as WebGL2RenderingContext, raw: gl }
}

test('polls parallel compilation without blocking on link status', () => {
  let complete = false
  const { gl, raw } = fakeGl(() => complete)
  const program = {} as WebGLProgram
  expect(programReady(gl, program)).toBe(false)
  expect(raw.getProgramParameter).not.toHaveBeenCalledWith(program, LINK)
  complete = true
  expect(programReady(gl, program)).toBe(true)
  raw.getProgramParameter.mockClear()
  expect(programReady(gl, program)).toBe(true)
  expect(raw.getProgramParameter).not.toHaveBeenCalled()
})

test('a lazy program compiles once and reads no uniform until it has linked', () => {
  let complete = false
  const { gl, raw } = fakeGl(() => complete)
  const lazy = new LazyProgram('vs', 'fs', ['u_matrix'], 'test')
  expect(raw.createProgram).not.toHaveBeenCalled()
  expect(lazy.use(gl)).toBeNull()
  expect(lazy.use(gl)).toBeNull()
  expect(raw.createProgram).toHaveBeenCalledTimes(1)
  expect(raw.getUniformLocation).not.toHaveBeenCalled()
  complete = true
  expect(lazy.use(gl)?.u.u_matrix).toEqual({ name: 'u_matrix' })
  expect(raw.createProgram).toHaveBeenCalledTimes(1)
})
