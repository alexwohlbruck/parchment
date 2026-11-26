/** A booking or delivery site's mark: a coloured tile holding a letter or a 20×20 path. */
export interface BookingBrand {
  name: string
  /** Absent for a brand whose host also serves unrelated pages. */
  host?: RegExp
  background: string
  foreground: string
  letter?: string
  /** Drawn in `foreground` on a 20×20 grid, in place of the letter. */
  path?: string
  /** Second colour for a dot or accent in the mark. */
  accent?: string
}

export const BOOKING_BRANDS = {
  opentable: {
    name: 'OpenTable',
    host: /(^|\.)opentable\.[a-z.]+$/,
    background: '#DA3743',
    foreground: '#FFFFFF',
    path: 'M8 5.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8Zm0 2.2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM14.6 8.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z',
  },
  resy: { name: 'Resy', host: /(^|\.)resy\.com$/, background: '#FF462D', foreground: '#FFFFFF', letter: 'R' },
  tock: { name: 'Tock', host: /(^|\.)exploretock\.com$/, background: '#1C1C1C', foreground: '#FFFFFF', letter: 'T' },
  sevenrooms: {
    name: 'SevenRooms',
    host: /(^|\.)sevenrooms\.com$/,
    background: '#0B1F3A',
    foreground: '#FFFFFF',
    letter: '7',
  },
  yelp: { name: 'Yelp', host: /(^|\.)yelp\.[a-z.]+$/, background: '#D32323', foreground: '#FFFFFF', letter: 'y' },
  bookingcom: {
    name: 'Booking.com',
    host: /(^|\.)booking\.com$/,
    background: '#003580',
    foreground: '#FFFFFF',
    letter: 'B',
    accent: '#00A2FF',
  },
  expedia: {
    name: 'Expedia',
    host: /(^|\.)expedia\.[a-z.]+$/,
    background: '#FDDB32',
    foreground: '#191E3B',
    path: 'M6 5.5h8.5V14h-2.4V9.6l-5.4 5.4L5 13.3l5.4-5.4H6Z',
  },
  hotelscom: { name: 'Hotels.com', host: /(^|\.)hotels\.com$/, background: '#D32F2F', foreground: '#FFFFFF', letter: 'H' },
  googleHotels: {
    name: 'Google Hotels',
    background: '#FFFFFF',
    foreground: '#4285F4',
    letter: 'G',
  },
  ubereats: {
    name: 'Uber Eats',
    host: /(^|\.)ubereats\.com$/,
    background: '#06C167',
    foreground: '#142328',
    letter: 'E',
  },
  doordash: {
    name: 'DoorDash',
    host: /(^|\.)doordash\.com$/,
    background: '#FF3008',
    foreground: '#FFFFFF',
    path: 'M3.5 6.5h8.2a4.2 4.2 0 0 1 0 8.4H7.4l1.4-2.2h2.9a2 2 0 0 0 0-4H4.9Z',
  },
  grubhub: { name: 'Grubhub', host: /(^|\.)grubhub\.com$/, background: '#FF8000', foreground: '#FFFFFF', letter: 'g' },
  seamless: { name: 'Seamless', host: /(^|\.)seamless\.com$/, background: '#1D80D9', foreground: '#FFFFFF', letter: 'S' },
  postmates: { name: 'Postmates', host: /(^|\.)postmates\.com$/, background: '#1C1C1C', foreground: '#FFFFFF', letter: 'P' },
  deliveroo: {
    name: 'Deliveroo',
    host: /(^|\.)deliveroo\.[a-z.]+$/,
    background: '#00CCBC',
    foreground: '#FFFFFF',
    letter: 'D',
  },
  justeat: { name: 'Just Eat', host: /(^|\.)just-eat\.[a-z.]+$/, background: '#FF8000', foreground: '#FFFFFF', letter: 'J' },
} satisfies Record<string, BookingBrand>

export type BookingBrandKey = keyof typeof BOOKING_BRANDS

export function isBookingBrand(key: string): key is BookingBrandKey {
  return key in BOOKING_BRANDS
}

/** The brand whose site a URL is on. */
export function bookingBrandOf(raw: string): BookingBrandKey | null {
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
  const keys = Object.keys(BOOKING_BRANDS) as BookingBrandKey[]
  return keys.find(key => (BOOKING_BRANDS[key] as BookingBrand).host?.test(host)) ?? null
}

/** A site's bare hostname, for naming a page on a site we have no brand for. */
export function siteName(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return raw
  }
}
