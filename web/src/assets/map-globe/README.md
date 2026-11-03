# Night lights

`night-lights.webp` is a 4096 × 2048 reduction of NASA's 2016 Black Marble
grayscale global composite. It is equirectangular, with north at the top and
longitude −180° at the left. Regenerate with `node web/scripts/build-night-lights.mjs`.

Source: [NASA Earth at Night maps](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/),
2016 grayscale, 3 km JPEG.

NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data
from Miguel Román, NASA Goddard Space Flight Center. The imagery is historical,
not a live view of individual lights.

# Milky Way

`milky-way.webp` is a 4096 × 2048 reduction of the photographic all-sky
[Milky Way panorama](https://www.eso.org/public/images/eso0932a/).
Credit: ESO/S. Brunier. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The image has been resized and recompressed, and its brightness is adjusted in
view. Regenerate with `node web/scripts/build-milky-way.mjs`.

The panorama is in galactic coordinates, with the Galactic Centre in the
middle and galactic north at the top. The renderer rotates it into Earth's
frame using sidereal time and the equatorial-to-galactic rotation.

# Daylight haze

`transmittance.png` is a 256 × 64 sunlight-transmission lookup generated from
the atmosphere model. It adds about 14 KB and loads only in globe view.
Regenerate with `bun web/scripts/build-atmosphere.ts`. The daylight surface
uses scattering through a 100 km shell; the outer glow and nighttime haze
use the softer halo.

# Clouds

`clouds.webp` is a 3072 × 1536 grayscale reduction of NASA's Blue Marble cloud
composite, not live weather. Source: [NASA Blue Marble: Clouds](https://visibleearth.nasa.gov/images/57747/blue-marble-clouds).
Credit: NASA Goddard Space Flight Center / Reto Stöckli. The composite combines
visible imagery from two days and polar infrared imagery from a third day.
Regenerate with `node web/scripts/build-clouds.mjs`.

The bundled texture is a fallback for the current 4K cloud feed from
[Live Cloud Maps](https://github.com/matteason/live-cloud-maps). That feed
contains modified EUMETSAT data, is published every three hours, and supports
browser CORS. It is about 1.5 MB and can have missing regions or older imagery
when satellite observations are unavailable. Polar gaps are mirrored by the
provider. The renderer checks for updates every three hours while the satellite
or hybrid globe is visible; it keeps existing imagery if an update fails.

The texture loads only in satellite/hybrid globe view and occupies one GPU channel. Clouds sit
7 km above Earth, receive sunlight, cast soft surface shadows, and fade out
with the globe effect as you zoom in.

# Ocean reflections

`ocean-mask.webp` is a 3072 × 1536 lossless mask generated from Natural Earth's
public-domain 1:50m land polygons, version 5.1.2. White marks ocean, black land.
Regenerate with `node web/scripts/build-ocean-mask.mjs`. The 115 KiB mask limits
satellite/hybrid ocean tint and sun glint to water; polar reflectivity fades
out toward the ice caps. It adds no live data dependency.

# Moon

`moon.webp` is a 1024 × 512 reduction of the 2025 LROC color map from
[NASA's CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/).
Credit: NASA's Scientific Visualization Studio. The equirectangular map has
north at the top and the near side centred at 0° longitude. Regenerate with
`node web/scripts/build-moon.mjs`.

The satellite/hybrid globe loads this 92 KB texture locally. The Moon uses a
low-precision [SunCalc lunar orbit](https://github.com/mourner/suncalc/blob/v1.9.0/suncalc.js)
and Earth-fixed sidereal rotation, with physical distance and radius. Sunlight
creates the phase directly on the sphere. The near side stays facing Earth;
libration, eclipses, and terrain shadows are not modelled. The sky refreshes
every minute and when the page becomes visible, without continuous animation.
