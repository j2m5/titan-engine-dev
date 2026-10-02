import { WATER_GLINT_CEILING, WATER_GLINT_F0, WATER_MAX_ALPHA2, WATER_MIN_ALPHA2 } from './waterOctavesMath'

/** GLSL float-литерал: целое без точки дало бы int в float-выражении. */
export function glslFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

/**
 * Блик воды — общий для водной оболочки (WaterShaderTemplate) и легаси-сферы
 * тела с водой (PlanetShaderTemplate, USE_SPECULAR): на гейте карты высот блик
 * один и тот же. CPU-зеркало — waterGlint в waterOctavesMath.ts.
 */
export const waterGlintFunctions = /* glsl */ `
  #define WATER_GLINT_F0 ${glslFloat(WATER_GLINT_F0)}
  #define WATER_GLINT_CEILING ${glslFloat(WATER_GLINT_CEILING)}
  #define WATER_MIN_ALPHA2 ${glslFloat(WATER_MIN_ALPHA2)}
  #define WATER_MAX_ALPHA2 ${glslFloat(WATER_MAX_ALPHA2)}
  #define WATER_PI 3.141592653589793

  // Блик: нормированный Блинн–Фонг (p+8)/(8π)·(N·H)^p, p = 2/α² − 2, × N·L × Шлик (F0 воды),
  // потолок WATER_GLINT_CEILING; n, l, v — единичные, одна система координат
  float waterGlintGlsl(vec3 n, vec3 l, vec3 v, float alpha2) {
    float nDotL = dot(n, l);
    if (nDotL <= 0.0) return 0.0;
    vec3 hSum = l + v;
    vec3 h = hSum / max(length(hSum), 1e-6);
    float p = 2.0 / clamp(alpha2, WATER_MIN_ALPHA2, WATER_MAX_ALPHA2) - 2.0;
    float fresnel = WATER_GLINT_F0 + (1.0 - WATER_GLINT_F0) * pow(1.0 - clamp(dot(v, h), 0.0, 1.0), 5.0);
    // основание pow > 0: pow(0, 0) в GLSL не определён
    float lobe = (p + 8.0) / (8.0 * WATER_PI) * pow(max(dot(n, h), 1e-8), p);
    return min(lobe * nDotL * fresnel, WATER_GLINT_CEILING);
  }
`
