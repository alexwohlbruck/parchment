/**
 * Many small model files as one: the length of a JSON index, the index of
 * name → [offset, length], then the files end to end. The object layer waits
 * for every model before it draws, so one request serves it where each model
 * was its own.
 */
import { parseGlb } from './glb.mjs'

/** @param {Array<[string, Uint8Array]>} files */
export function packModels(files) {
  const index = {}
  let offset = 0
  for (const [name, bytes] of files) {
    index[name] = [offset, bytes.length]
    offset += bytes.length
  }
  const header = new TextEncoder().encode(JSON.stringify(index))
  const pack = new Uint8Array(4 + header.length + offset)
  new DataView(pack.buffer).setUint32(0, header.length, true)
  pack.set(header, 4)
  for (const [name, bytes] of files) pack.set(bytes, 4 + header.length + index[name][0])
  return pack
}

/**
 * @param {ArrayBuffer} pack
 * @returns {Map<string, ArrayBuffer>} each file's own copy of its bytes
 */
export function unpackModels(pack) {
  const headerLength = new DataView(pack).getUint32(0, true)
  const index = JSON.parse(new TextDecoder().decode(new Uint8Array(pack, 4, headerLength)))
  const start = 4 + headerLength
  return new Map(Object.entries(index).map(([name, [offset, length]]) => [name, pack.slice(start + offset, start + offset + length)]))
}

/** Every model in a pack, parsed, by name. */
export async function loadModelPack(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  const models = {}
  for (const [name, bytes] of unpackModels(await response.arrayBuffer())) models[name] = parseGlb(bytes)
  return models
}
