export const CLOUDS_URL = 'https://clouds.matteason.co.uk/images/4096x2048/clouds.jpg'
export const CLOUD_REFRESH_MS = 3 * 60 * 60 * 1000
export const CLOUDS_ATTRIBUTION = '<a href="https://github.com/matteason/live-cloud-maps" target="_blank">Contains modified EUMETSAT data</a> · NASA cloud fallback'


export const CLOUDS_GLSL = `
const float CLOUD_RADIUS = 1.0011;
vec2 earthUv(vec3 point) {
    return vec2(atan(point.x, point.z) / 6.28318530718 + 0.5, 0.5 - asin(clamp(point.y, -1.0, 1.0)) / 3.14159265359);
}
float cloudDensity(vec3 point) {
    return pow(smoothstep(0.08, 0.98, texture(u_clouds, earthUv(point)).r), 1.15);
}
float cloudShadow(vec3 surface, float sunHeight) {
    if (u_cloud_blend == 0.0 || u_lighting == 0.0) return 0.0;
    float distance = -sunHeight + sqrt(sunHeight * sunHeight + CLOUD_RADIUS * CLOUD_RADIUS - 1.0);
    vec3 point = normalize(surface + u_sun * distance);
    return cloudDensity(point) * smoothstep(0.0, 0.16, sunHeight) * u_lighting * u_cloud_blend * 0.18;
}
vec4 cloudLayer(vec3 origin, vec3 ray, float along, float distanceToCenter) {
    if (u_cloud_blend == 0.0) return vec4(0.0);
    float discriminant = CLOUD_RADIUS * CLOUD_RADIUS - distanceToCenter * distanceToCenter;
    if (discriminant <= 0.0) return vec4(0.0);
    vec3 point = normalize(origin + ray * (along - sqrt(discriminant)));
    float density = cloudDensity(point) * u_cloud_blend;
    float sunHeight = dot(point, u_sun);
    float daylight = smoothstep(-0.08, 0.14, sunHeight);
    float brightness = mix(1.0, 0.025 + daylight * (0.50 + 0.475 * pow(max(sunHeight, 0.0), 0.45)), u_lighting);
    float twilight = exp(-pow(sunHeight / 0.10, 2.0)) * u_lighting;
    vec3 tint = mix(vec3(0.93, 0.97, 1.0), vec3(1.0, 0.63, 0.36), twilight * 0.65);
    vec3 color = tint * min(1.0, brightness * sqrt(u_exposure));
    return vec4(color, density * 0.88);
}
`
