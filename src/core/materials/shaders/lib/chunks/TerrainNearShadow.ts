import { NEAR_SHADOW_BIAS_SLOPE, NEAR_SHADOW_STEPS } from '@/core/terrain/terrainNearShadowMath'

/**
 * Ближний слой тени рельефа: марш по плитке высот у камеры (NearShadowTile).
 * GLSL-двойник terrainNearShadowMath.ts — держать построчно синхронно.
 * Юниформы — в terrainShadowMarchUniforms; чанк только под USE_TERRAIN_SHADOW.
 *
 * Плитка: метры по осям E, N от центра, гномоническая проекция; строка 0 —
 * юг (v = 0, DataTexture без flipY), столбец 0 — запад; LinearFilter без мипов.
 * Выборки — с явным LOD: марш идёт в неоднородной ветке и цикле с break.
 */
export const terrainNearShadowFunctions = /* glsl */ `
  #define TERRAIN_NEAR_SHADOW_STEPS ${NEAR_SHADOW_STEPS}
  #define TERRAIN_NEAR_SHADOW_BIAS_SLOPE ${NEAR_SHADOW_BIAS_SLOPE}

  // (x, y) = R·(d·E, d·N)/(d·c), метры; d — в полусфере центра плитки
  vec2 terrainNearTileXY(vec3 d) {
    float k = uBodyRadiusMeters / dot(d, uNearTileCenter);
    return vec2(dot(d, uNearTileEast), dot(d, uNearTileNorth)) * k;
  }

  // центр тексела i ↔ (i + 0.5)/texels
  vec2 terrainNearTileUv(vec2 xy) {
    return xy / (uNearTileTexels * uNearTileTexelMeters) + 0.5;
  }

  // высота над сферой относительно центра плитки, метры
  float terrainNearTileHeight(vec2 xy) {
    return texture2DLodEXT(uNearTile, terrainNearTileUv(xy), 0.0).r;
  }

  // 1 внутри 0.8·half, 0 на краю плитки, по max(|x|, |y|)
  float terrainNearEdgeWeight(vec2 xy) {
    float halfMeters = 0.5 * uNearTileTexels * uNearTileTexelMeters;
    return 1.0 - smoothstep(0.8 * halfMeters, halfMeters, max(abs(xy.x), abs(xy.y)));
  }

  // вес ближнего слоя во фрагменте; uNearTileWeight уже несёт высоту камеры и силу ручки
  float terrainNearShadowWeight(vec3 dir) {
    // задняя полусфера: проекция не определена
    if (dot(dir, uNearTileCenter) <= 0.0) return 0.0;
    return uNearTileWeight * terrainNearEdgeWeight(terrainNearTileXY(dir));
  }

  // 1 — освещено, 0 — в тени; dir — радиаль фрагмента, sunLocal — единичное НА солнце.
  // Без раннего выхода по солнцу под горизонтом — тень даёт сам марш
  float terrainNearShadowMarch(vec3 dir, vec3 sunLocal) {
    float se = dot(sunLocal, uNearTileEast);
    float sn = dot(sunLocal, uNearTileNorth);
    float horiz = length(vec2(se, sn));
    // солнце в зените (по базису центра плитки): направления по плитке нет
    if (horiz < 1e-6) return 1.0;
    vec2 stepDir = vec2(se, sn) / horiz;

    float sinT = dot(sunLocal, dir);
    float tanT = sinT / max(sqrt(max(1.0 - sinT * sinT, 0.0)), 1e-6);
    float R = uBodyRadiusMeters;
    vec2 p0 = terrainNearTileXY(dir);
    float h0 = terrainNearTileHeight(p0);

    float bias = uNearTileTexelMeters * TERRAIN_NEAR_SHADOW_BIAS_SLOPE;
    float sMin = uNearTileTexelMeters;
    float sMax = max(uNearShadowMaxDistMeters, sMin * 2.0);
    float ratio = pow(sMax / sMin, 1.0 / float(TERRAIN_NEAR_SHADOW_STEPS - 1));
    float s = sMin;
    float occl = 0.0;

    for (int i = 0; i < TERRAIN_NEAR_SHADOW_STEPS; i++) {
      // кривизна ПЛЮС: сфера уходит из-под прямой
      float hRay = h0 + s * tanT + s * s / (2.0 * R);
      float pen = (terrainNearTileHeight(p0 + stepDir * s) - hRay - bias) / max(s * uShadowPenumbraTan, 1e-6);
      occl = max(occl, clamp(pen, 0.0, 1.0));
      if (occl >= 1.0) break;
      s *= ratio;
    }

    return 1.0 - occl;
  }
`
