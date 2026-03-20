import type { Serializer } from '@vueuse/core'

/**
 * JSON serializer for useStorage with nullable object/array defaults.
 *
 * vueuse's useStorage infers the serializer from the default value's type.
 * When the default is `null`, it picks the "any" serializer which uses
 * `String(v)` to write — corrupting objects/arrays into "[object Object]".
 * Use this serializer explicitly for any useStorage call whose default is
 * `null` but whose actual values are objects or arrays.
 */
export const jsonSerializer: Serializer<any> = {
  read: (v: string) => {
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  },
  write: (v: any) => JSON.stringify(v),
}
