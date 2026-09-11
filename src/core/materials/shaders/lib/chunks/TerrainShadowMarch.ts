import { TERRAIN_SHADOW_BIAS_SLOPE, TERRAIN_SHADOW_STEPS } from './terrainShadowMath'

/**
 * Собственная тень рельефа: марш по низкой карте высот (terrainShadowMap) к
 * солнцу в системе тела. Множит ТОЛЬКО прямой свет (directGain в
 * PlanetShaderTemplate). CPU-зеркало и константы — terrainShadowMath.ts.
 *
 * Своя развёртка, не terrainUv: карта — DataTexture без flipY (строка 0 =
 * север, v = acos(y)/π без переворота), а выбор домена по fwidth внутри
 * цикла с break не определён; мипов нет, отрицательный u заворачивает
 * RepeatWrapping.
 */
export const terrainShadowMarchUniforms = /* glsl */ `
  uniform sampler2D uShadowHeightMap;
  uniform float uShadowHeightMin;
  uniform float uShadowHeightRange;
  uniform float uShadowTexelAngle;
  uniform float uShadowMaxDistUnits;
  uniform float uShadowPenumbraTan;
  uniform float uTerrainShadowStrength;
`

export const terrainShadowMarchFunctions = /* glsl */ `
  #define TERRAIN_SHADOW_STEPS ${TERRAIN_SHADOW_STEPS}
  // bias = texel · это, высота: склон положе ≈3° тени на себя не кладёт
  #define TERRAIN_SHADOW_BIAS_SLOPE ${TERRAIN_SHADOW_BIAS_SLOPE}

  vec2 terrainShadowUv(vec3 dirLocal) {
    float phi = atan(dirLocal.z, -dirLocal.x);
    return vec2(phi / 6.28318530717958647692, acos(clamp(dirLocal.y, -1.0, 1.0)) / 3.14159265358979323846);
  }

  float terrainShadowHeight(vec3 dirLocal) {
    return uShadowHeightMin + texture2D(uShadowHeightMap, terrainShadowUv(dirLocal)).r * uShadowHeightRange;
  }

  // 1 — освещено, 0 — в тени; dir — радиаль фрагмента, sunLocal — единичное НА солнце, система тела
  float terrainShadowMarch(vec3 dir, vec3 sunLocal) {
    float cosSun = dot(dir, sunLocal);
    if (cosSun <= 0.0) return 1.0;

    float R = uBodyRadiusUnits;
    vec3 p0 = dir * (R + terrainShadowHeight(dir));
    // дуга текселя — первый шаг и смещение: короче неё карта ничего не знает
    float texel = R * uShadowTexelAngle;
    float bias = texel * TERRAIN_SHADOW_BIAS_SLOPE;
    float sMin = texel * 2.0;
    float sMax = max(uShadowMaxDistUnits, sMin * 2.0);
    // геометрический шаг: у подножия важен тексель, в хвосте — десятки км
    float ratio = pow(sMax / sMin, 1.0 / float(TERRAIN_SHADOW_STEPS - 1));
    float s = sMin;
    float occl = 0.0;

    for (int i = 0; i < TERRAIN_SHADOW_STEPS; i++) {
      vec3 p = p0 + sunLocal * s;
      float r = length(p);
      vec3 d = p / r;
      // |p| растёт по s монотонно при cosSun > 0: за горизонт луч уводит только рельеф
      float hRay = r - R;
      // полутень: заглубление луча в долях углового размера солнца на этой дистанции
      float pen = (terrainShadowHeight(d) - hRay - bias) / max(s * uShadowPenumbraTan, 1e-6);
      occl = max(occl, clamp(pen, 0.0, 1.0));
      if (occl >= 1.0) break;
      s *= ratio;
    }

    return 1.0 - occl;
  }
`
