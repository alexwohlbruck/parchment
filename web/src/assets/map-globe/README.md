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
