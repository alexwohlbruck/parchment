export class GlobeTexture {
  private texture?: WebGLTexture
  private bitmap?: ImageBitmap
  private request?: AbortController
  private loadedAt?: number

  constructor(private readonly url: string, private readonly singleChannel = false) {}

  get ready() {
    return this.loadedAt !== undefined
  }

  get blend() {
    return this.loadedAt === undefined ? 0 : Math.min(1, (performance.now() - this.loadedAt) / 600)
  }

  load(repaint: () => void) {
    if (this.request) return
    const request = this.request = new AbortController()
    void fetch(this.url, { signal: request.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Globe texture: ${response.status}`)
        return response.blob()
      })
      .then(blob => createImageBitmap(blob, { colorSpaceConversion: 'none' }))
      .then(bitmap => {
        if (request.signal.aborted) {
          bitmap.close()
          return
        }
        this.bitmap = bitmap
        repaint()
      })
      .catch(() => {})
  }

  bind(gl: WebGL2RenderingContext, unit = 0) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    const internal = this.singleChannel ? gl.R8 : gl.RGB8
    const format = this.singleChannel ? gl.RED : gl.RGB
    if (!this.texture) {
      this.texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, 1, 1, 0, format, gl.UNSIGNED_BYTE, new Uint8Array(this.singleChannel ? 1 : 3))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.generateMipmap(gl.TEXTURE_2D)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
    }
    if (this.bitmap) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, format, gl.UNSIGNED_BYTE, this.bitmap)
      gl.generateMipmap(gl.TEXTURE_2D)
      this.bitmap.close()
      this.bitmap = undefined
      this.loadedAt = performance.now()
    }
  }

  dispose(gl: WebGL2RenderingContext) {
    this.request?.abort()
    this.request = undefined
    this.bitmap?.close()
    this.bitmap = undefined
    if (this.texture) gl.deleteTexture(this.texture)
    this.texture = undefined
    this.loadedAt = undefined
  }
}
