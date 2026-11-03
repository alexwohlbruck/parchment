import { siderealAngle } from '@/lib/map/sun-position'

const RAD = Math.PI / 180
const OBLIQUITY = 23.4397 * RAD
const EARTH_RADIUS_KM = 6371
export const MOON_RADIUS = 1737.4 / EARTH_RADIUS_KM
export const MOON_ATTRIBUTION = '<a href="https://svs.gsfc.nasa.gov/4720/" target="_blank">Moon: NASA’s Scientific Visualization Studio</a>'

// Low-precision lunar orbit from SunCalc; coordinates use the globe's Earth-fixed axes.
export function moonPosition(date: Date): [number, number, number] {
  const days = date.getTime() / 86400000 - 10957.5
  const anomaly = (134.963 + 13.064993 * days) * RAD
  const latitudeArgument = (93.272 + 13.229350 * days) * RAD
  const longitude = (218.316 + 13.176396 * days) * RAD + 6.289 * RAD * Math.sin(anomaly)
  const latitude = 5.128 * RAD * Math.sin(latitudeArgument)
  const distance = (385001 - 20905 * Math.cos(anomaly)) / EARTH_RADIUS_KM
  const x = Math.cos(latitude) * Math.cos(longitude)
  const y = Math.cos(latitude) * Math.sin(longitude) * Math.cos(OBLIQUITY) - Math.sin(latitude) * Math.sin(OBLIQUITY)
  const z = Math.cos(latitude) * Math.sin(longitude) * Math.sin(OBLIQUITY) + Math.sin(latitude) * Math.cos(OBLIQUITY)
  const angle = siderealAngle(date)
  return [
    distance * (y * Math.cos(angle) - x * Math.sin(angle)),
    distance * z,
    distance * (x * Math.cos(angle) + y * Math.sin(angle)),
  ]
}

export const MOON_GLSL = `
uniform vec3 u_moon;
uniform float u_moon_visible;
uniform sampler2D u_moon_texture;
uniform float u_moon_blend;
vec4 moonSurface(vec3 origin, vec3 ray) {
    if (u_moon_visible == 0.0) return vec4(0.0);
    vec3 relative = origin - u_moon;
    float along = -dot(relative, ray);
    vec3 closest = relative + ray * along;
    float radius = ${MOON_RADIUS};
    float distance = length(closest);
    float pixel = max(fwidth(distance), 0.00001);
    float coverage = 1.0 - smoothstep(radius - pixel, radius + pixel, distance);
    if (along <= 0.0 || coverage <= 0.0) return vec4(0.0);
    vec3 normal = normalize(closest - ray * sqrt(max(0.0, radius * radius - distance * distance)));
    vec3 front = -normalize(u_moon);
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), front));
    vec3 north = cross(front, east);
    vec2 uv = vec2(0.5 + atan(dot(normal, east), dot(normal, front)) / 6.28318530718,
        0.5 - asin(clamp(dot(normal, north), -1.0, 1.0)) / 3.14159265359);
    vec3 albedo = mix(vec3(0.65), texture(u_moon_texture, uv).rgb, u_moon_blend);
    float sunlight = max(dot(normal, u_sun), 0.0);
    vec3 color = albedo * (0.004 + 0.996 * pow(sunlight, 0.55));
    return vec4(color, coverage);
}
`
