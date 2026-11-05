export interface OpenSourceProject {
  name: string
  url: string
}

export interface OpenSourceGroup {
  /** Product name, or `null` for open data, whose label is translated. */
  name: string | null
  projects: readonly OpenSourceProject[]
}

const project = (name: string, url: string): OpenSourceProject => ({ name, url })

export const OPEN_SOURCE: readonly OpenSourceGroup[] = [
  {
    name: 'Parchment',
    projects: [
      project('Vue', 'https://vuejs.org'),
      project('Vue Router', 'https://router.vuejs.org'),
      project('Pinia', 'https://pinia.vuejs.org'),
      project('Vue I18n', 'https://vue-i18n.intlify.dev'),
      project('VueUse', 'https://vueuse.org'),
      project('Reka UI', 'https://reka-ui.com'),
      project('shadcn-vue', 'https://www.shadcn-vue.com'),
      project('Vaul Vue', 'https://github.com/unovue/vaul-vue'),
      project('Tailwind CSS', 'https://tailwindcss.com'),
      project('Vite', 'https://vite.dev'),
      project('Tauri', 'https://tauri.app'),
      project('MapLibre GL JS', 'https://maplibre.org'),
      project('Turf', 'https://turfjs.org'),
      project('Mapillary JS', 'https://github.com/mapillary/mapillary-js'),
      project('PhotoSwipe', 'https://photoswipe.com'),
      project('Lucide', 'https://lucide.dev'),
      project('Simple Icons', 'https://simpleicons.org'),
      project('Maki', 'https://github.com/mapbox/maki'),
      project('Geist', 'https://vercel.com/font'),
      project('Day.js', 'https://day.js.org'),
      project('SunCalc', 'https://github.com/mourner/suncalc'),
      project('Zod', 'https://zod.dev'),
      project('Bun', 'https://bun.sh'),
      project('Elysia', 'https://elysiajs.com'),
      project('Drizzle ORM', 'https://orm.drizzle.team'),
      project('PostgreSQL', 'https://www.postgresql.org'),
      project('Lucia', 'https://lucia-auth.com'),
      project('SimpleWebAuthn', 'https://simplewebauthn.dev'),
      project('noble cryptography', 'https://paulmillr.com/noble'),
      project('OpenTelemetry', 'https://opentelemetry.io'),
      project('sharp', 'https://sharp.pixelplumbing.com'),
      project('iD tagging schema', 'https://github.com/openstreetmap/id-tagging-schema'),
      project('Name Suggestion Index', 'https://nsi.guide'),
      project('opening_hours.js', 'https://github.com/opening-hours/opening_hours.js'),
      project('geo-tz', 'https://github.com/evansiroky/node-geo-tz'),
    ],
  },
  {
    name: 'Barrelman',
    projects: [
      project('MOTIS', 'https://github.com/motis-project/motis'),
      project('GraphHopper', 'https://www.graphhopper.com'),
      project('Pelias', 'https://pelias.io'),
      project('Martin', 'https://martin.maplibre.org'),
      project('Planetiler', 'https://github.com/onthegomap/planetiler'),
      project('PMTiles', 'https://github.com/protomaps/PMTiles'),
      project('osm2pgsql', 'https://osm2pgsql.org'),
      project('Osmium', 'https://osmcode.org/osmium-tool'),
      project('PostGIS', 'https://postgis.net'),
      project('pgvector', 'https://github.com/pgvector/pgvector'),
      project('Ollama', 'https://ollama.com'),
      project('Kokoro-FastAPI', 'https://github.com/remsky/Kokoro-FastAPI'),
      project('GTFS Realtime bindings', 'https://github.com/MobilityData/gtfs-realtime-bindings'),
      project('earcut', 'https://github.com/mapbox/earcut'),
      project('Bun', 'https://bun.sh'),
      project('Elysia', 'https://elysiajs.com'),
      project('Drizzle ORM', 'https://orm.drizzle.team'),
    ],
  },
  {
    name: 'Portolan',
    projects: [
      project('Go', 'https://go.dev'),
      project('Vue', 'https://vuejs.org'),
      project('Reka UI', 'https://reka-ui.com'),
      project('Tailwind CSS', 'https://tailwindcss.com'),
      project('Vite', 'https://vite.dev'),
    ],
  },
  {
    name: null,
    projects: [
      project('OpenStreetMap', 'https://www.openstreetmap.org/copyright'),
      project('Transitland', 'https://www.transit.land'),
      project('OpenAddresses', 'https://openaddresses.io'),
      project('Wikidata', 'https://www.wikidata.org'),
      project('Open Landmarks', 'https://github.com/benjamintd/open-landmarks'),
    ],
  },
]

/** Distinct projects across every group; shared ones count once. */
export function openSourceCount(groups: readonly OpenSourceGroup[] = OPEN_SOURCE): number {
  return new Set(groups.flatMap(group => group.projects.map(p => p.url))).size
}
