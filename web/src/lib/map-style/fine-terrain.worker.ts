import { ParentHeights, upsampledTile } from './fine-terrain'

const parents = new ParentHeights()

self.onmessage = async ({ data: { id, z, x, y } }: MessageEvent<{ id: number; z: number; x: number; y: number }>) => {
  const image = await upsampledTile(z, x, y, parents).catch(() => null)
  ;(self as unknown as Worker).postMessage({ id, image }, image ? [image] : [])
}
