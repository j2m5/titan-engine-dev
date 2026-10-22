/** Original atlas vertex main at b8d4d3d8. Keep independent of production
 * culling so retained color/depth comparisons cannot share a bad predicate. */
const originalMain = `
  vAtlasParams = vec3(0.0);
  vAtlasViewToObject = mat3(1.0);
  vAtlasRayPoint = vec3(0.0);
  vAtlasFrames = vAtlasWeights = vec3(0.0);
  if (uImpostorReady > 0.5 && instanceDetailEnd > 0.0) {
    int slot = int(clamp(instanceArchetype, 0.0, 63.0));
    float h = uImpostorHalfExtents[slot];
    mat3 instanceLinear = mat3(instanceMatrix);
    if (h <= 0.0 || abs(determinant(instanceLinear)) < 1e-20) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float seed = hash13(instanceMatrix[3].xyz);
    mat3 spin = asteroidSpinMatrix(seed);
    mat3 a = mat3(modelViewMatrix) * instanceLinear * spin * uImpostorPhysicalSize;
    vAtlasViewToObject = inverse(a);
    vec3 center = (modelViewMatrix * vec4(instanceOrigin + instanceMatrix[3].xyz, 1.0)).xyz;
    vec3 cameraObject = -vAtlasViewToObject * center;
    bool perspective = isPerspectiveMatrix(projectionMatrix);
    impostorSelectFrames(perspective ? cameraObject : vAtlasViewToObject * vec3(0.0, 0.0, 1.0));
    vec3 extent = h * vec3(length(vec3(a[0].x, a[1].x, a[2].x)), length(vec3(a[0].y, a[1].y, a[2].y)), length(vec3(a[0].z, a[1].z, a[2].z)));
    vec2 halfSize = extent.xy;
    if (perspective) {
      float depth = max(-center.z, 1e-6);
      halfSize = (extent.xy + abs(center.xy) * extent.z / depth) * depth / max(depth - extent.z, 1e-6);
    }
    vec3 quad = center + vec3((uv * 2.0 - 1.0) * halfSize, 0.0);
    vAtlasRayPoint = vAtlasViewToObject * (perspective ? quad : vec3(quad.xy, 0.0));
    vAtlasParams = vec3(float(uImpostorSlotLayers[slot]), h, 1.0);
    vRingPos = center;
    vPlanetDirView = (modelViewMatrix * vec4(-uOriginOffset, 1.0)).xyz;
    vRingNormalView = normalize(mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0));
    vLightDirView = (viewMatrix * vec4(uLightPosition, 1.0)).xyz;
    vInstanceSeed = hashSurface11(seed + 3.17);
    vEllipse = vec4(vec3(hashSurface11(seed + 1.1), hashSurface11(seed + 2.2), hashSurface11(seed + 3.3)) * 40.0, 0.0);
    vUv = uv;
    vHalfExtent = h;
    vFade = instanceFade;
    float dist = length(center);
    #ifdef USE_CASCADE_FADE_RADIUS
      vDistanceFade = 1.0 - smoothstep(instanceMaxDistance * 0.6, instanceMaxDistance, dist);
    #else
      vDistanceFade = 1.0 - smoothstep(uMaxDistance * 0.6, uMaxDistance, dist);
    #endif
    gl_Position = projectionMatrix * vec4(quad, 1.0);
    return;
  }
`

export function unculledVertexReference(source: string): string {
  const start = source.indexOf('  vAtlasParams = vec3(0.0);')
  const end = source.indexOf('          vec3 instancePos = instanceOrigin + vec3(', start)
  if (start < 0 || end < start) throw new Error('Original atlas vertex boundaries missing')
  return source.slice(0, start) + originalMain + source.slice(end)
}
