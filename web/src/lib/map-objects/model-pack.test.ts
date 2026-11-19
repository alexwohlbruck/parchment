import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { packModels, unpackModels } from './model-pack.mjs'
import { OBJECT_MODELS, OBJECT_MODEL_PACK } from './index'

const bytesOf = (path: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../../public', `.${path}`)))

describe('model pack', () => {
  it('hands each file back as it went in', () => {
    const files: Array<[string, Uint8Array]> = [['a', new Uint8Array([1, 2, 3])], ['né', new Uint8Array([])], ['c', new Uint8Array([9])]]
    const pack = packModels(files)
    const out = unpackModels(pack.buffer as ArrayBuffer)
    expect([...out.keys()]).toEqual(['a', 'né', 'c'])
    for (const [name, bytes] of files) expect([...new Uint8Array(out.get(name)!)]).toEqual([...bytes])
  })

  it('ships every object model, byte for byte as its own file has it', () => {
    const pack = bytesOf(OBJECT_MODEL_PACK)
    const packed = unpackModels(pack.buffer.slice(pack.byteOffset, pack.byteOffset + pack.byteLength) as ArrayBuffer)
    expect([...packed.keys()].sort()).toEqual(Object.keys(OBJECT_MODELS).sort())
    for (const [name, url] of Object.entries(OBJECT_MODELS)) expect(Buffer.from(packed.get(name)!).equals(Buffer.from(bytesOf(url))), name).toBe(true)
  })
})
