interface Contributor {
  name: string
  /** i18n key describing what they contributed. */
  creditKey: string
}

export const CONTRIBUTORS: readonly Contributor[] = [
  { name: 'Jeremy Dean', creditKey: 'attribution.credits.jeremyDean' },
]
