/**
 * Draws whatever comes next at `opacity`, whatever its shader writes, by
 * blending on a constant alpha. Returns whether it did, so the caller can stop
 * writing depth: a see-through surface must not hide what is behind it.
 */
export function ghostBlend(gl: WebGL2RenderingContext, opacity: number): boolean {
  if (opacity >= 1) return false
  gl.enable(gl.BLEND)
  gl.blendColor(0, 0, 0, opacity)
  gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA)
  return true
}
