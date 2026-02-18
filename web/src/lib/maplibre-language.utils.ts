/**
 * MapLibre language utility
 * Similar to @mapbox/mapbox-gl-language but for MapLibre
 *
 * This utility transforms a MapLibre style to use language-specific text fields.
 * It handles both simple get expressions and nested expressions.
 */

type StyleLayer = any
type StyleSpecification = any

/**
 * Check if an expression is a simple get expression for a name field
 */
function isNameGetExpression(expression: any): boolean {
  if (!Array.isArray(expression)) return false
  if (expression[0] !== 'get') return false
  if (typeof expression[1] !== 'string') return false

  // Check if it's a name field (name, name_en, name:en, etc.)
  const field = expression[1]
  return (
    field === 'name' || field.startsWith('name_') || field.startsWith('name:')
  )
}

/**
 * Transform a get expression to use the specified language
 */
function transformGetExpression(expression: any, language: string): any {
  if (!isNameGetExpression(expression)) return expression

  const field = expression[1]

  // If it's already a specific language field, replace it
  if (field.startsWith('name_') || field.startsWith('name:')) {
    return ['get', `name:${language}`]
  }

  // If it's the generic 'name' field, use coalesce with language fallback
  return ['coalesce', ['get', `name:${language}`], ['get', 'name']]
}

/**
 * Recursively transform expressions to use the specified language
 */
function transformExpression(expression: any, language: string): any {
  if (!Array.isArray(expression)) return expression

  // Handle get expressions
  if (expression[0] === 'get' && isNameGetExpression(expression)) {
    return transformGetExpression(expression, language)
  }

  // Handle coalesce expressions - transform all get expressions inside
  if (expression[0] === 'coalesce') {
    return [
      'coalesce',
      ...expression
        .slice(1)
        .map((exp: any) => transformExpression(exp, language)),
    ]
  }

  // Handle other expressions recursively
  return expression.map((item: any) => {
    if (Array.isArray(item)) {
      return transformExpression(item, language)
    }
    return item
  })
}

/**
 * Transform a MapLibre style to use the specified language
 *
 * @param style - The MapLibre style object
 * @param language - The language code (e.g., 'en', 'es', 'fr')
 * @returns The modified style object
 */
export function setMapLibreLanguage(
  style: StyleSpecification,
  language: string,
): StyleSpecification {
  if (!style || !style.layers) return style

  // Clone the style to avoid mutating the original
  const modifiedStyle = JSON.parse(JSON.stringify(style))

  // Transform each symbol layer's text-field
  modifiedStyle.layers = modifiedStyle.layers.map((layer: StyleLayer) => {
    if (layer.type !== 'symbol') return layer
    if (!layer.layout || !layer.layout['text-field']) return layer

    const textField = layer.layout['text-field']

    // Handle string literals (old token format like "{name}" - not common in modern styles)
    if (typeof textField === 'string') {
      if (textField.includes('{name}')) {
        layer.layout['text-field'] = [
          'coalesce',
          ['get', `name:${language}`],
          ['get', 'name'],
        ]
      }
      return layer
    }

    // Handle expression format
    if (Array.isArray(textField)) {
      layer.layout['text-field'] = transformExpression(textField, language)
    }

    return layer
  })

  return modifiedStyle
}

/**
 * Apply language change to a MapLibre map instance
 * This updates layers in place without reloading the entire style
 *
 * @param map - The MapLibre map instance
 * @param language - The language code (e.g., 'en', 'es', 'fr')
 */
export function applyMapLibreLanguage(map: any, language: string): void {
  const style = map.getStyle()
  if (!style || !style.layers) return

  const modifiedStyle = setMapLibreLanguage(style, language)

  // Update each layer's text-field property individually
  modifiedStyle.layers.forEach((layer: StyleLayer) => {
    if (layer.type !== 'symbol') return
    if (!layer.layout || !layer.layout['text-field']) return

    try {
      map.setLayoutProperty(layer.id, 'text-field', layer.layout['text-field'])
    } catch (error) {
      // Layer might not exist or support this operation
      console.debug(`Could not update language for layer ${layer.id}:`, error)
    }
  })
}
