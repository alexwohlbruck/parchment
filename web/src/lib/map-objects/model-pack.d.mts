import type { GlbModel } from './glb.mjs'

export function packModels(files: Array<[string, Uint8Array]>): Uint8Array
export function unpackModels(pack: ArrayBuffer): Map<string, ArrayBuffer>
export function loadModelPack(url: string): Promise<Record<string, GlbModel>>
