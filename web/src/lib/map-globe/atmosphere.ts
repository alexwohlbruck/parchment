export const EARTH_RADIUS = 6_371_000
export const ATMOSPHERE_HEIGHT = 100_000
export const TRANSMITTANCE_WIDTH = 256
export const TRANSMITTANCE_HEIGHT = 64

const TOP = 1 + ATMOSPHERE_HEIGHT / EARTH_RADIUS
const RAYLEIGH_HEIGHT = 8000 / EARTH_RADIUS
const MIE_HEIGHT = 1200 / EARTH_RADIUS
const OZONE_CENTRE = 25_000 / EARTH_RADIUS
const OZONE_WIDTH = 15_000 / EARTH_RADIUS
const RAYLEIGH = [5.802e-6, 13.558e-6, 33.1e-6].map(value => value * EARTH_RADIUS)
const MIE_SCATTERING = 3.996e-6 * EARTH_RADIUS
const MIE_EXTINCTION = 4.44e-6 * EARTH_RADIUS
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6].map(value => value * EARTH_RADIUS)

export function atmosphericTransmission(altitude: number, cosine: number): number[] {
  const radius = 1 + Math.max(0, Math.min(ATMOSPHERE_HEIGHT, altitude)) / EARTH_RADIUS
  const mu = Math.max(-1, Math.min(1, cosine))
  const impactSquared = radius * radius * (1 - mu * mu)
  if (mu < 0 && impactSquared < 1) return [0, 0, 0]
  const distance = -radius * mu + Math.sqrt(Math.max(0, TOP * TOP - impactSquared))
  const step = distance / 128
  const depth = [0, 0, 0]
  for (let i = 0; i < 128; i++) {
    const along = (i + 0.5) * step
    const h = Math.max(0, Math.sqrt(radius * radius + along * along + 2 * radius * mu * along) - 1)
    depth[0] += Math.exp(-h / RAYLEIGH_HEIGHT) * step
    depth[1] += Math.exp(-h / MIE_HEIGHT) * step
    depth[2] += Math.max(0, 1 - Math.abs(h - OZONE_CENTRE) / OZONE_WIDTH) * step
  }
  return RAYLEIGH.map((beta, channel) => Math.exp(-beta * depth[0] - MIE_EXTINCTION * depth[1] - OZONE[channel] * depth[2]))
}

export function buildTransmittanceLookup(): Uint8Array {
  const data = new Uint8Array(TRANSMITTANCE_WIDTH * TRANSMITTANCE_HEIGHT * 3)
  for (let y = 0; y < TRANSMITTANCE_HEIGHT; y++) {
    const altitude = (y / (TRANSMITTANCE_HEIGHT - 1)) ** 2 * ATMOSPHERE_HEIGHT
    for (let x = 0; x < TRANSMITTANCE_WIDTH; x++) {
      const t = x / (TRANSMITTANCE_WIDTH - 1) * 2 - 1
      const transmission = atmosphericTransmission(altitude, Math.sign(t) * t * t)
      for (let channel = 0; channel < 3; channel++) {
        data[(y * TRANSMITTANCE_WIDTH + x) * 3 + channel] = Math.round(transmission[channel] * 255)
      }
    }
  }
  return data
}

const scalar = (value: number) => value.toFixed(10)
const vector = (values: number[]) => `vec3(${values.map(scalar).join(', ')})`

export const ATMOSPHERE_GLSL = `
const float ATM_TOP = ${scalar(TOP)};
const vec3 ATM_RAYLEIGH = ${vector(RAYLEIGH)};
const float ATM_MIE_SCATTERING = ${scalar(MIE_SCATTERING)};
const float ATM_MIE_EXTINCTION = ${scalar(MIE_EXTINCTION)};
const vec3 ATM_OZONE = ${vector(OZONE)};
const float ATM_NODES[8] = float[8](-0.9602898565, -0.7966664774, -0.5255324099, -0.1834346425, 0.1834346425, 0.5255324099, 0.7966664774, 0.9602898565);
const float ATM_WEIGHTS[8] = float[8](0.1012285363, 0.2223810345, 0.3137066459, 0.3626837834, 0.3626837834, 0.3137066459, 0.2223810345, 0.1012285363);
struct Atmosphere {
    vec3 radiance;
    vec3 transmission;
};
vec3 atmosphereDensity(float h) {
    return vec3(exp(-h / ${scalar(RAYLEIGH_HEIGHT)}), exp(-h / ${scalar(MIE_HEIGHT)}), max(0.0, 1.0 - abs(h - ${scalar(OZONE_CENTRE)}) / ${scalar(OZONE_WIDTH)}));
}
vec3 sunlightTransmission(vec3 point, vec3 sun) {
    float radius = length(point);
    float mu = clamp(dot(point, sun) / radius, -1.0, 1.0);
    vec2 uv = vec2(0.5 + 0.5 * sign(mu) * sqrt(abs(mu)), sqrt(clamp((radius - 1.0) / (ATM_TOP - 1.0), 0.0, 1.0)));
    uv = (uv * vec2(${TRANSMITTANCE_WIDTH - 1}.0, ${TRANSMITTANCE_HEIGHT - 1}.0) + 0.5) / vec2(${TRANSMITTANCE_WIDTH}.0, ${TRANSMITTANCE_HEIGHT}.0);
    return texture(u_transmittance, uv).rgb;
}
Atmosphere scatterAtmosphere(vec3 origin, vec3 ray, vec3 sun, float groundDistance) {
    Atmosphere result = Atmosphere(vec3(0.0), vec3(1.0));
    float along = dot(origin, ray);
    float discriminant = along * along - dot(origin, origin) + ATM_TOP * ATM_TOP;
    if (discriminant <= 0.0) return result;
    float root = sqrt(discriminant);
    float entry = max(0.0, -along - root);
    float exit = min(-along + root, groundDistance);
    if (exit <= entry) return result;
    float halfLength = (exit - entry) * 0.5;
    float middle = (entry + exit) * 0.5;
    float mu = clamp(dot(ray, sun), -1.0, 1.0);
    float rayleighPhase = 3.0 * (1.0 + mu * mu) / (16.0 * 3.14159265359);
    float miePhase = 0.36 / (4.0 * 3.14159265359 * pow(1.64 - 1.6 * mu, 1.5));
    vec3 depth = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        vec3 point = origin + ray * (middle + halfLength * ATM_NODES[i]);
        vec3 density = atmosphereDensity(max(0.0, length(point) - 1.0));
        vec3 delta = density * halfLength * ATM_WEIGHTS[i];
        vec3 opticalDepth = ATM_RAYLEIGH * delta.x + ATM_MIE_EXTINCTION * delta.y + ATM_OZONE * delta.z;
        vec3 attenuation = exp(-ATM_RAYLEIGH * depth.x - ATM_MIE_EXTINCTION * depth.y - ATM_OZONE * depth.z);
        vec3 segmentTransmission = (1.0 - exp(-opticalDepth)) / max(opticalDepth, vec3(0.000001));
        vec3 source = ATM_RAYLEIGH * delta.x * rayleighPhase + vec3(ATM_MIE_SCATTERING * delta.y * miePhase);
        result.radiance += attenuation * sunlightTransmission(point, sun) * source * segmentTransmission;
        depth += delta;
    }
    result.transmission = exp(-ATM_RAYLEIGH * depth.x - ATM_MIE_EXTINCTION * depth.y - ATM_OZONE * depth.z);
    result.radiance += (1.0 - result.transmission) * vec3(0.002, 0.004, 0.009);
    return result;
}
`
