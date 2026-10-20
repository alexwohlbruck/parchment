export const OCEAN_GLSL = `
vec4 oceanSurface(vec3 normal, vec3 ray, float daylight) {
    if (u_ocean_blend == 0.0) return vec4(0.0);
    float water = smoothstep(0.75, 0.98, texture(u_ocean, earthUv(normal)).r);
    float ice = 1.0 - smoothstep(0.94, 0.99, abs(normal.y));
    float strength = water * ice * u_ocean_blend;
    float sunHeight = dot(normal, u_sun);
    float light = mix(1.0, daylight, u_lighting);
    float viewCosine = max(0.0, dot(normal, -ray));
    float fresnel = 0.02 + 0.98 * pow(1.0 - viewCosine, 5.0);
    float reflectedSun = max(0.0, dot(reflect(ray, normal), u_sun));
    float reflection = (pow(reflectedSun, 28.0) * 0.16 + pow(reflectedSun, 120.0) * 0.28)
        * (0.6 + fresnel * 2.0) * smoothstep(0.0, 0.12, sunHeight) * u_lighting;
    float coverage = strength * light * 0.42;
    vec3 color = vec3(0.065, 0.17, 0.39) * coverage;
    color += vec3(1.0, 0.96, 0.84) * reflection * strength;
    return vec4(color, coverage);
}
`
