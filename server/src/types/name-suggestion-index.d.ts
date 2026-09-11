/**
 * The package declares its types only inside `exports`, which this project's
 * `moduleResolution: "node"` doesn't read. Declare what we use.
 */
declare module 'name-suggestion-index' {
  /** NSI's name normalization: lowercase, strip diacritics and punctuation. */
  export function simplify(str: string): string
}
