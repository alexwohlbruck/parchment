import { describe, expect, test } from 'bun:test'
import { readSiteBusinesses, specificationToOsm } from './schema-org'

const page = (...blocks: unknown[]) =>
  blocks.map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`).join('\n')

describe('readSiteBusinesses', () => {
  test('reads a bakery with its address, position, contact and hours', () => {
    const [bakery] = readSiteBusinesses(
      page({
        '@context': 'https://schema.org',
        '@type': 'Bakery',
        name: 'Sunflower  Bakery',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '12 Haywood Street',
          addressLocality: 'Asheville',
          addressRegion: 'NC',
          postalCode: '28801',
          addressCountry: { '@type': 'Country', name: 'US' },
        },
        geo: { latitude: '35.5951', longitude: '-82.5515' },
        telephone: '+1 828-555-0100',
        email: 'mailto:hello@sunflower.example',
        openingHoursSpecification: [
          { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '07:00', closes: '15:00' },
          { dayOfWeek: 'https://schema.org/Saturday', opens: '08:00:00', closes: '13:00:00' },
        ],
      }),
    )
    expect(bakery).toEqual({
      name: 'Sunflower Bakery',
      types: ['Bakery'],
      address: { street: '12 Haywood Street', locality: 'Asheville', region: 'NC', postalCode: '28801', country: 'US' },
      geo: { lat: 35.5951, lng: -82.5515 },
      phone: '+1 828-555-0100',
      email: 'hello@sunflower.example',
      openingHours: 'Mo-Fr 07:00-15:00; Sa 08:00-13:00',
    })
  })

  test('finds businesses inside a @graph and a chain’s locations, skipping the website itself', () => {
    const found = readSiteBusinesses(
      page({
        '@graph': [
          { '@type': 'WebSite', name: 'Joe’s', url: 'https://joes.example' },
          {
            '@type': 'Organization',
            name: 'Joe’s Pizza',
            location: [
              { '@type': 'Restaurant', name: 'Joe’s Pizza Brooklyn', address: { streetAddress: '1 Court St' } },
              { '@type': 'Restaurant', name: 'Joe’s Pizza Queens', address: { streetAddress: '2 Main St' } },
            ],
          },
        ],
      }),
    )
    expect(found.map((business) => business.name)).toEqual(['Joe’s Pizza Brooklyn', 'Joe’s Pizza Queens'])
  })

  test('ignores broken JSON and businesses with nowhere to put them', () => {
    const html = `<script type="application/ld+json">{ not json</script>${page({ '@type': 'Cafe', name: 'Nowhere' })}`
    expect(readSiteBusinesses(html)).toEqual([])
  })

  test('marks a permanently closed business', () => {
    const [business] = readSiteBusinesses(
      page({ '@type': 'Store', name: 'Gone', address: { streetAddress: '9 Elm St' }, businessStatus: 'PermanentlyClosed' }),
    )
    expect(business.closed).toBe(true)
  })
})

describe('specificationToOsm', () => {
  test('is 24/7 when every day runs midnight to midnight', () => {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    expect(specificationToOsm([{ dayOfWeek: days, opens: '00:00', closes: '23:59' }])).toBe('24/7')
  })

  test('keeps split shifts and skips seasonal entries', () => {
    expect(
      specificationToOsm([
        { dayOfWeek: 'Sunday', opens: '17:00', closes: '22:00' },
        { dayOfWeek: 'Sunday', opens: '11:00', closes: '14:00' },
        { dayOfWeek: 'Monday', opens: '09:00', closes: '12:00', validFrom: '2026-12-24' },
      ]),
    ).toBe('Su 11:00-14:00,17:00-22:00')
  })
})
