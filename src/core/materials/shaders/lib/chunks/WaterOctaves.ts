import {
  WATER_GLINT_CEILING,
  WATER_GLINT_F0,
  WATER_MAX_ALPHA2,
  WATER_MIN_ALPHA2,
  WATER_OCTAVE_SLOPE_VARIANCE,
  WATER_RIPPLE_OCTAVE_GAIN,
  WATER_RIPPLE_PERIODS_METERS,
  WATER_TRIPLANAR_SLOPE_GAIN2,
  WATER_WAVE_PERIODS_METERS,
  rippleSpeedMps
} from './waterOctavesMath'

/** Направления скролла мелких октав (единичные, по порядку периодов) — чередуются, чтобы слои не ехали вместе. */
export const WATER_RIPPLE_DIRECTIONS: readonly (readonly [number, number])[] = (
  [
    [1, 0.6],
    [-0.7, 1],
    [0.4, -1],
    [-1, -0.3],
    [0.8, 0.8]
  ] as const
).map(([x, y]) => {
  const len = Math.hypot(x, y)
  return [x / len, y / len] as const
})

// GLSL float-литерал: целое без точки дало бы int в float-выражении
function glslFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

const rippleDefines = WATER_RIPPLE_PERIODS_METERS.map((period, i) => {
  const [dx, dy] = WATER_RIPPLE_DIRECTIONS[i]
  const tilesPerSecond = rippleSpeedMps(period) / period
  return [
    `  #define WATER_RIPPLE_PERIOD_${i} ${glslFloat(period)}`,
    `  #define WATER_RIPPLE_SCROLL_${i} vec2(${glslFloat(dx * tilesPerSecond)}, ${glslFloat(dy * tilesPerSecond)})`
  ].join('\n')
}).join('\n')

const waveDefines = WATER_WAVE_PERIODS_METERS.map((period, i) => `  #define WATER_WAVE_PERIOD_${i} ${glslFloat(period)}`).join(
  '\n'
)

// Домены и производные всех октав — до любого ветвления по весу
const rippleDomains = WATER_RIPPLE_PERIODS_METERS.map((_period, i) =>
  [
    `    vec3 q${i} = posM / WATER_RIPPLE_PERIOD_${i};`,
    `    q${i}.xy += WATER_RIPPLE_SCROLL_${i} * t;`,
    `    vec3 q${i}Dx = dFdx(q${i});`,
    `    vec3 q${i}Dy = dFdy(q${i});`
  ].join('\n')
).join('\n')

const rippleBranches = WATER_RIPPLE_PERIODS_METERS.map((_period, i) =>
  [
    `    float w${i} = waterOctaveWeight(WATER_RIPPLE_PERIOD_${i}, footprint);`,
    `    fadedVariance += (1.0 - w${i}) * s2V;`,
    `    if (w${i} > 0.0) dev += w${i} * waterRippleOctave(q${i}, q${i}Dx, q${i}Dy, dirLocal, tw, axisSign);`
  ].join('\n')
).join('\n')

/**
 * Мелкие октавы ряби воды (2560…10 м), вес октав по футпринту пикселя и блик по шероховатости.
 * CPU-зеркало и константы — waterOctavesMath.ts.
 *
 * Домен posM — тело-локальная позиция минус k·W (WATER_DETAIL_WRAP), метры:
 * каждый период делит W, скролл — сдвиг тайла, поэтому домен W-периодичен
 * и шва на границе патчей нет. Ничего непериодичного по W сюда не входит.
 *
 * Выборки — только texture2DGradEXT: ветка по весу неоднородна, неявные
 * производные внутри неё не определены; dFdx/dFdy считаются до ветвления.
 * Нужны объявленные выше uWaterNormalMap, uTime, uWaterWaveSpeed, uWaterRippleStrength.
 */
export const waterOctavesFunctions = /* glsl */ `
${rippleDefines}
${waveDefines}
  // средняя дисперсия наклона одной октавы ассета (замер waternormals.jpg)
  #define WATER_OCTAVE_SLOPE_VARIANCE ${glslFloat(WATER_OCTAVE_SLOPE_VARIANCE)}
  // трипланар усиливает тангенциальный наклон в 1.5: дисперсия в нормали — 1.5²·V
  #define WATER_TRIPLANAR_SLOPE_GAIN2 ${glslFloat(WATER_TRIPLANAR_SLOPE_GAIN2)}
  // амплитуда мелкой октавы: Σ дисперсий 5 мелких = дисперсия среднего 4 крупных
  #define WATER_RIPPLE_OCTAVE_GAIN ${glslFloat(WATER_RIPPLE_OCTAVE_GAIN)}
  #define WATER_GLINT_F0 ${glslFloat(WATER_GLINT_F0)}
  #define WATER_GLINT_CEILING ${glslFloat(WATER_GLINT_CEILING)}
  #define WATER_MIN_ALPHA2 ${glslFloat(WATER_MIN_ALPHA2)}
  #define WATER_MAX_ALPHA2 ${glslFloat(WATER_MAX_ALPHA2)}
  #define WATER_PI 3.141592653589793

  // 1 при period ≥ 4f, 0 при period ≤ 2f; f — футпринт пикселя, м (пол — края smoothstep не совпадают)
  float waterOctaveWeight(float period, float footprint) {
    float f = max(footprint, 1e-6);
    return smoothstep(2.0 * f, 4.0 * f, period);
  }

  // Футпринт пикселя на поверхности, м; μv клампится к 0.2 — скользящий взгляд конечен
  float waterFootprintMeters(float distanceMeters, float pixelAngle, float muV) {
    return distanceMeters * pixelAngle / max(muV, 0.2);
  }

  // Тангенциальная часть нормали одной октавы в тело-локальных XYZ. Свизлы, веса 1.5/1.0
  // и axisSign — как у waterWaveNormal (несущая компонента со знаком своей оси)
  vec3 waterRippleOctave(vec3 q, vec3 qDx, vec3 qDy, vec3 dirLocal, vec3 tw, vec3 axisSign) {
    vec3 nX = 2.0 * texture2DGradEXT(uWaterNormalMap, q.zy, qDx.zy, qDy.zy).xyz - 1.0;
    vec3 nY = 2.0 * texture2DGradEXT(uWaterNormalMap, q.xz, qDx.xz, qDy.xz).xyz - 1.0;
    vec3 nZ = 2.0 * texture2DGradEXT(uWaterNormalMap, q.xy, qDx.xy, qDy.xy).xyz - 1.0;
    vec3 fromX = nX.zyx * vec3(1.0, 1.5, 1.5) * vec3(axisSign.x, 1.0, 1.0);
    vec3 fromY = nY.xzy * vec3(1.5, 1.0, 1.5) * vec3(1.0, axisSign.y, 1.0);
    vec3 fromZ = nZ.xyz * vec3(1.5, 1.5, 1.0) * vec3(1.0, 1.0, axisSign.z);
    vec3 n = fromX * tw.x + fromY * tw.y + fromZ * tw.z;
    return n - dirLocal * dot(n, dirLocal);
  }

  // Отклонение нормали от мелких октав (тело-локальные XYZ) и Σ(1 − wᵢ)·(s·gain)²·V погасших.
  // Звать в однородном потоке: внутри dFdx/dFdy
  vec3 waterRippleDeviation(vec3 posM, vec3 dirLocal, float footprint, out float fadedVariance) {
    vec3 tw = abs(dirLocal);
    tw /= max(tw.x + tw.y + tw.z, 1e-6);
    vec3 axisSign = sign(dirLocal);
    float t = uTime * uWaterWaveSpeed;
${rippleDomains}
    vec3 dev = vec3(0.0);
    fadedVariance = 0.0;
    float rippleAmp = uWaterRippleStrength * WATER_RIPPLE_OCTAVE_GAIN;
    float s2V = rippleAmp * rippleAmp * WATER_OCTAVE_SLOPE_VARIANCE;
${rippleBranches}
    return dev * rippleAmp;
  }

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
