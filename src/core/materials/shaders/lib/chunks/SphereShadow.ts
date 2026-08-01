/**
 * Тень планеты на точке вне её поверхности (кольцо, отсвет колец).
 *
 * `lightDirLocal` — направление РАСПРОСТРАНЕНИЯ света (от звезды к сцене),
 * то же соглашение, что у `vLocalLightDirection` планеты и `vLightDirectionL`
 * кольца: положительный `dot(pos, sunDir)` = точка за планетой, кандидат в тень.
 */
export const sphereShadowFunctions = `
  float getShadowFromSphere(vec3 lightDirLocal, vec3 ringPosLocal, float planetRadius) {
    vec3 sunDir = normalize(lightDirLocal);
    float pDotL = dot(ringPosLocal, sunDir);
    if (pDotL <= 0.0) return 1.0; // солнечная сторона — не в тени
    // Мягкая кромка полутени (~8% радиуса планеты) вместо жёсткого перехода:
    // perp — расстояние от точки до оси теневого цилиндра вдоль направления на солнце
    float perp = sqrt(max(dot(ringPosLocal, ringPosLocal) - pDotL * pDotL, 0.0));
    float penumbra = planetRadius * 0.08;
    float shade = smoothstep(planetRadius, planetRadius + penumbra, perp);
    return mix(0.04, 1.0, shade); // 0.04 в умбре → 1.0 вне тени
  }
`
