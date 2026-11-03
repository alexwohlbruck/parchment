export class GlobeTexture {
  private texture?: WebGLTexture
  private bitmap?: ImageBitmap
  private request?: AbortController
  private loadedAt?: number
  private refreshTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly url: string, private readonly options: { singleChannel?: boolean; clamp?: boolean; fallbackUrl?: string; refreshMs?: number } = {}) {}

  get ready() {
    return this.loadedAt !== undefined
  }

  get blend() {
    return this.loadedAt === undefined ? 0 : Math.min(1, (performance.now() - this.loadedAt) / 600)
  }

  load(repaint: () => void) {
    if (this.request) return
    const request = this.request = new AbortController()
    const retrieve = async (url: string) => {
      const response = await fetch(url, { signal: request.signal })
      if (!response.ok) throw new Error(`Globe texture: ${response.status}`)
      return createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' })
    }
    void retrieve(this.url)
      .catch(error => {
        if (request.signal.aborted || !this.options.fallbackUrl || this.ready) throw error
        return retrieve(this.options.fallbackUrl)
      })
      .then(bitmap => {
        if (request.signal.aborted) {
          bitmap.close()
          return
        }
        this.bitmap?.close()
        this.bitmap = bitmap
        repaint()
      })
      .catch(() => {})
      .finally(() => {
        if (!this.options.refreshMs || request.signal.aborted) return
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = undefined
          this.request = undefined
          repaint()
        }, this.options.refreshMs)
      })
  }

  bind(gl: WebGL2RenderingContext, unit = 0) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    const internal = this.options.singleChannel ? gl.R8 : gl.RGB8
    const format = this.options.singleChannel ? gl.RED : gl.RGB
    if (!this.texture) {
      this.texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, 1, 1, 0, format, gl.UNSIGNED_BYTE, new Uint8Array(this.options.singleChannel ? 1 : 3))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.options.clamp ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.options.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      if (!this.options.clamp) gl.generateMipmap(gl.TEXTURE_2D)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
    }
    if (this.bitmap) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, format, gl.UNSIGNED_BYTE, this.bitmap)
      if (!this.options.clamp) gl.generateMipmap(gl.TEXTURE_2D)
      this.bitmap.close()
      this.bitmap = undefined
      this.loadedAt ??= performance.now()
    }
  }

  dispose(gl: WebGL2RenderingContext) {
    clearTimeout(this.refreshTimer)
    this.refreshTimer = undefined
    this.request?.abort()
    this.request = undefined
    this.bitmap?.close()
    this.bitmap = undefined
    if (this.texture) gl.deleteTexture(this.texture)
    this.texture = undefined
    this.loadedAt = undefined
  }
}
