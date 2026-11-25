export interface ListingSummary {
  id: string
  name: string | null
  address: string | null
  /** Metres from the place being matched. */
  distance: number | null
  /** The listing's page at the provider, when it has one to open. */
  url?: string | null
}

export interface ProviderListing {
  provider: string
  /** The listing the place is matched to, or null when it has none. */
  listing: ListingSummary | null
  /** A person chose this, including choosing "no listing". */
  confirmed: boolean
  /** Whether nearby listings can be searched for this provider. */
  searchable: boolean
  /** Whether the listing is set by pasting its page URL, for providers with no search to offer. */
  acceptsUrl: boolean
}
