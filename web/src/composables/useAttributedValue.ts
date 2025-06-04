import { computed, type ComputedRef } from 'vue'
import type { AttributedValue } from '../types/place.types'

/**
 * Create a computed property that accesses the value from an AttributedValue
 *
 * @param attributedValue - Ref or getter function for an AttributedValue
 * @param defaultValue - Optional default value to use if AttributedValue is null
 * @returns A computed property with the extracted value
 */
export function useAttributedValue<T, D = null>(
  attributedValue:
    | ComputedRef<AttributedValue<T> | null | undefined>
    | (() => AttributedValue<T> | null | undefined),
  defaultValue: D = null as unknown as D,
): ComputedRef<T | D> {
  return computed(() => {
    const value =
      typeof attributedValue === 'function'
        ? attributedValue()
        : attributedValue.value

    return value?.value ?? defaultValue
  })
}

/**
 * Create a computed property that formats an AttributedValue string
 *
 * @param attributedValue - Ref or getter function for an AttributedValue string
 * @param defaultValue - Default value to use if AttributedValue is null
 * @returns A computed property with the formatted string
 */
export function useFormattedText(
  attributedValue:
    | ComputedRef<AttributedValue<string> | null | undefined>
    | (() => AttributedValue<string> | null | undefined),
  defaultValue: string = '',
): ComputedRef<string> {
  return useAttributedValue(attributedValue, defaultValue)
}

/**
 * Create a computed property for the attribution source of an AttributedValue
 *
 * @param attributedValue - Ref or getter function for an AttributedValue
 * @returns A computed property with the source ID
 */
export function useAttributionSource<T>(
  attributedValue:
    | ComputedRef<AttributedValue<T> | null | undefined>
    | (() => AttributedValue<T> | null | undefined),
): ComputedRef<string | null> {
  return computed(() => {
    const value =
      typeof attributedValue === 'function'
        ? attributedValue()
        : attributedValue.value

    return value?.sourceId ?? null
  })
}

/**
 * Create a computed property that extracts a specific field from an AttributedValue<Record>
 *
 * @param attributedRecord - Ref or getter function for an AttributedValue containing a record
 * @param field - The field to extract from the record
 * @param defaultValue - Default value to use if the field is missing
 * @returns A computed property with the extracted field value
 */
export function useAttributedField<
  T extends Record<string, any>,
  K extends keyof T,
  D = null,
>(
  attributedRecord:
    | ComputedRef<AttributedValue<T> | null | undefined>
    | (() => AttributedValue<T> | null | undefined),
  field: K,
  defaultValue: D = null as unknown as D,
): ComputedRef<T[K] | D> {
  return computed(() => {
    const value =
      typeof attributedRecord === 'function'
        ? attributedRecord()
        : attributedRecord.value

    return value?.value?.[field] ?? defaultValue
  })
}
