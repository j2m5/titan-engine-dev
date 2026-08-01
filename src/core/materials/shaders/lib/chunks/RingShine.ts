export const ringShineUniforms = `
  uniform float uRingShineStrength;
`

/**
 * Отсвет колец на ночную сторону планеты: 4 сэмпла по радиусу кольца.
 *
 * Точка кольца берётся в азимутальной плоскости точки поверхности — ближайшая
 * часть кольца даёт основной вклад, дальняя не сэмплируется вовсе: её вклад
 * подавлен расстоянием и ракурсом (`cosReceiver`, `faceFactor`).
 * Яркость и цвет — из той же 1-D полосы, что уже используется для тени колец,
 * поэтому пер-планетных констант цвета не нужно.
 *
 * Гейты вместо ветвлений: `max(cosReceiver, 0.0)` гасит кольцо под горизонтом,
 * `getShadowFromSphere` — часть кольца в тени планеты.
 *
 * CPU-зеркало: tests/planet/ringShineMirror.ts — править вместе с этим файлом.
 */
export const ringShineFunctions = `
  #define RING_SHINE_SAMPLES 4

  vec3 getRingShine(vec3 nLocal, vec3 posLocal, vec3 lightDirLocal, float planetRadius) {
    vec3 ringNormal = vec3(0.0, 1.0, 0.0);

    vec3 azimuth = posLocal - dot(posLocal, ringNormal) * ringNormal;
    float azimuthLen = length(azimuth);
    if (azimuthLen < 1e-6) return vec3(0.0); // над полюсом кольцо симметрично

    azimuth /= azimuthLen;

    vec3 sum = vec3(0.0);

    for (int i = 0; i < RING_SHINE_SAMPLES; i++) {
      float t = (float(i) + 0.5) / float(RING_SHINE_SAMPLES);
      float r = mix(shadowRingsInnerRadius, shadowRingsOuterRadius, t);
      vec3 ringPos = azimuth * r;

      vec3 toRing = ringPos - posLocal;
      float dist = max(length(toRing), 1e-6);
      vec3 d = toRing / dist;

      float cosReceiver = max(dot(nLocal, d), 0.0);
      float faceFactor = abs(dot(ringNormal, d));
      float lit = getShadowFromSphere(lightDirLocal, ringPos, planetRadius);

      vec4 texel = texture2D(shadowRingsTexture, vec2(t, 0.0));

      sum += texel.rgb * texel.a * lit * cosReceiver * faceFactor;
    }

    return sum * (uRingShineStrength / float(RING_SHINE_SAMPLES));
  }
`
