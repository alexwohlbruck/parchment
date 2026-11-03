import { ParentHeights, upsampledTile } from './fine-terrain'

const parents = new ParentHeights()

type Job = { id: number; tile?: [number, number, number]; heights?: [number, number, number] }

self.onmessage = async ({ data: { id, tile, heights } }: MessageEvent<Job>) => {
  const post = (result: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage({ id, result }, transfer)
  if (heights) {
    const found = await parents.get(...heights).catch(() => null)
    // Copied out, as the cache keeps it for the finer tiles cut from it.
    post(found && { size: found.size, data: found.data.slice() })
    return
  }
  const image = tile ? await upsampledTile(...tile, parents).catch(() => null) : null
  post(image, image ? [image] : [])
}
