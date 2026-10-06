export const ringShadowUniforms = `
  uniform float shadowRingsInnerRadius;
  uniform float shadowRingsOuterRadius;
  uniform sampler2D shadowRingsTexture;
  uniform float uRingSunTan;
`

export const ringShadowFunctions = `
  // Тень кольца с полутенью: ширина по радиусу кольца растёт с расстоянием d до плоскости
  // вдоль луча к солнцу (d·tg углового радиуса солнца); 5 выборок треугольным ядром
  // (CPU-зеркало — src/core/eclipse/ringPenumbraMath.ts); вне кольца — прозрачно
  vec3 getShadowFromRings(vec3 lightColor, vec3 lightDir) {
    vec3 ringNormal = vec3(0.0, 1.0, 0.0);
    float d = dot(vPosition, ringNormal) / dot(lightDir, ringNormal);
    if (!(d > 0.0)) return lightColor;
    vec3 pointOnRingPlane = -d * lightDir + vPosition;
    float distanceOnPlane = length(pointOnRingPlane - dot(pointOnRingPlane, ringNormal) * ringNormal);
    float span = shadowRingsOuterRadius - shadowRingsInnerRadius;
    float u = (distanceOnPlane - shadowRingsInnerRadius) / span;
    float du = min(d * uRingSunTan / span, 4.0);
    float opacity = 0.0;
    for (int k = 0; k < 5; k++) {
      float weight = k == 2 ? 3.0 : (k == 1 || k == 3 ? 2.0 : 1.0);
      float uk = u + (float(k) - 2.0) * 0.5 * du;
      // маска вместо ветвления: выборка в однородном потоке;
      // щели лунок — маска радиуса тапа, чанк RingGap
      float a = texture2D(shadowRingsTexture, vec2(uk, 0.0)).a * step(0.0, uk) * step(uk, 1.0) * ringGapMask(shadowRingsInnerRadius + uk * span);
      opacity += weight * a;
    }
    return lightColor * (1.0 - opacity / 9.0);
  }
`

export const ringShadowFragment = `
  lightColor = getShadowFromRings(lightColor, normalize(vLocalLightDirection));
  finalColor *= lightColor;
`
