export type Validators<T> = { [K in keyof T]-?: (value: unknown) => value is T[K] }

export const oneOf =
  <const T>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.includes(value as T)

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

const keysOf = <T>(validators: Validators<T>) => Object.keys(validators) as Array<keyof T>

/** The settings in `stored` this app knows and can use; anything else is left out. */
export function pickValid<T>(validators: Validators<T>, stored: unknown): Partial<T> {
  if (typeof stored !== 'object' || stored === null) return {}
  const raw = stored as Record<keyof T, unknown>
  return Object.fromEntries(
    keysOf(validators).flatMap(key => (validators[key](raw[key]) ? [[key, raw[key]]] : [])),
  ) as Partial<T>
}

/** `source` narrowed to the settings that have a validator. */
export function pickKnown<T>(validators: Validators<T>, source: T): T {
  return Object.fromEntries(keysOf(validators).map(key => [key, source[key]])) as T
}
