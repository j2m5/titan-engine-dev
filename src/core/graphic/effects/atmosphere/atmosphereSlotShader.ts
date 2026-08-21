/**
 * atmosphereSlotShader.ts
 *
 * Сборка GLSL полноэкранного эффекта атмосфер: ядро Брунетона (без глобальных
 * сэмплеров и обёрток на константе ATMOSPHERE) плюс K независимых слотов —
 * по слоту на оболочку в кадре. Модуль только строит строки, GPU не трогает.
 */

import { atmosphereShader } from '@/core/renderables/Atmosphere/atmosphere'

/** Слотов оболочек в кадре: Сатурн + Титан — худший реальный случай, третий — запас. */
export const ATMOSPHERE_SLOTS = 3

/** Имена параметров Брунетона (как в createAtmosphereUniforms, без префикса u_). */
export const SLOT_PARAM_NAMES = [
  'solar_irradiance',
  'sun_angular_radius',
  'bottom_radius',
  'top_radius',
  'rayleigh_layer0',
  'rayleigh_layer1',
  'rayleigh_scattering',
  'mie_layer0',
  'mie_layer1',
  'mie_scattering',
  'mie_extinction',
  'mie_phase_function_g',
  'absorption_layer0',
  'absorption_layer1',
  'absorption_extinction',
  'ground_albedo',
  'mu_s_min'
] as const

export function slotUniformName(i: number, base: string): string {
  return `uSlot${i}_${base}`
}

/**
 * Ядро Брунетона: всё до `#define RADIANCE_API_ENABLED`. Дальше в atmosphere.ts
 * идут глобальные сэмплеры и обёртки на макросе ATMOSPHERE — эффекту с K
 * слотами они не подходят. Константа ATMOSPHERE (земные числа) вырезается:
 * параметры приходят в функции ядра аргументом.
 */
export function buildAtmosphereCoreGlsl(): string {
  const cut = atmosphereShader.indexOf('#define RADIANCE_API_ENABLED')
  if (cut < 0) throw new Error('atmosphereSlotShader: маркер RADIANCE_API_ENABLED не найден в atmosphere.ts')

  const head = atmosphereShader.slice(0, cut)
  const constRegex = /const\s+AtmosphereParameters\s+ATMOSPHERE\s*=\s*AtmosphereParameters\s*\([^;]+\);/s
  if (!constRegex.test(head)) throw new Error('atmosphereSlotShader: константа ATMOSPHERE не найдена')

  // Ядро объявляет `const float PI`, а three's <common> выше по проходу держит
  // `#define PI ...` — без снятия макроса объявление препроцессится в мусор.
  return `\n  #undef PI\n${head.replace(constRegex, '')}`
}

/**
 * Снятие макросов ядра в конце фрагмента: postprocessing склеивает эффекты
 * прохода в один шейдер, и `Length`/`Number`/`IN` не должны течь к соседям.
 * PI возвращается таким же, как в three's <common>.
 */
const CORE_MACROS_CLEANUP_GLSL = /* glsl */ `
  #undef Length
  #undef Number
  #undef Position
  #undef Direction
  #undef Angle
  #undef IN
  #undef OUT
  #undef assert
  #define PI 3.141592653589793
`

export function buildSlotGlsl(i: number): string {
  const u = (base: string): string => slotUniformName(i, base)

  return /* glsl */ `
  // ── Слот ${i}: параметры Брунетона + LUT одной атмосферы ──
  uniform vec3 ${u('solar_irradiance')};
  uniform float ${u('sun_angular_radius')};
  uniform float ${u('bottom_radius')};
  uniform float ${u('top_radius')};
  uniform float ${u('rayleigh_layer0')}[5];
  uniform float ${u('rayleigh_layer1')}[5];
  uniform vec3 ${u('rayleigh_scattering')};
  uniform float ${u('mie_layer0')}[5];
  uniform float ${u('mie_layer1')}[5];
  uniform vec3 ${u('mie_scattering')};
  uniform vec3 ${u('mie_extinction')};
  uniform float ${u('mie_phase_function_g')};
  uniform float ${u('absorption_layer0')}[5];
  uniform float ${u('absorption_layer1')}[5];
  uniform vec3 ${u('absorption_extinction')};
  uniform vec3 ${u('ground_albedo')};
  uniform float ${u('mu_s_min')};

  uniform sampler2D ${u('transmittance')};
  uniform sampler3D ${u('scattering')};
  uniform sampler2D ${u('irradiance')};

  // Центр оболочки относительно камеры, км (float64-вычитание на CPU)
  uniform vec3 ${u('center')};
  uniform vec3 ${u('sunDir')};
  uniform vec2 ${u('sunSize')};
  uniform float ${u('exposure')};
  uniform float ${u('hdrKnee')};

  AtmosphereParameters buildSlot${i}() {
    return AtmosphereParameters(
      ${u('solar_irradiance')},
      ${u('sun_angular_radius')},
      ${u('bottom_radius')},
      ${u('top_radius')},
      DensityProfile(DensityProfileLayer[2](
        buildLayer(${u('rayleigh_layer0')}), buildLayer(${u('rayleigh_layer1')})
      )),
      ${u('rayleigh_scattering')},
      DensityProfile(DensityProfileLayer[2](
        buildLayer(${u('mie_layer0')}), buildLayer(${u('mie_layer1')})
      )),
      ${u('mie_scattering')},
      ${u('mie_extinction')},
      ${u('mie_phase_function_g')},
      DensityProfile(DensityProfileLayer[2](
        buildLayer(${u('absorption_layer0')}), buildLayer(${u('absorption_layer1')})
      )),
      ${u('absorption_extinction')},
      ${u('ground_albedo')},
      ${u('mu_s_min')}
    );
  }

  /**
   * Композиция одной оболочки в color: луч от камеры (ноль) по dir, distKm —
   * расстояние до поверхности из глубины (INF — небо). Мимо оболочки или
   * поверхность перед ней — color не трогается.
   */
  void applySlot${i}(vec3 dir, float distKm, inout vec3 color) {
    vec3 center = ${u('center')};
    float top = ${u('top_radius')};

    float b = dot(dir, center);
    float c = dot(center, center) - top * top;
    float disc = b * b - c;
    if (disc <= 0.0) return;
    float root = sqrt(disc);
    float tExit = b + root;
    if (tExit <= 0.0) return;
    bool inside = c < 0.0;
    float t0 = inside ? 0.0 : b - root;
    if (t0 >= distKm) return;

    bool hitSurface = distKm < tExit;
    float t1 = hitSurface ? distKm : tExit;

    AtmosphereParameters atm = buildSlot${i}();
    vec3 p0 = dir * t0 - center;
    // Страховка на 5-метровый зазор CameraCollision у дна
    float r0 = length(p0);
    p0 *= max(r0, atm.bottom_radius + 0.01) / max(r0, 1e-6);

    vec3 transmittance;
    vec3 radiance;
    if (hitSurface) {
      vec3 p1 = dir * t1 - center;
      radiance = GetSkyRadianceToPoint(atm, ${u('transmittance')}, ${u('scattering')}, ${u('scattering')},
        p0, p1, 0.0, ${u('sunDir')}, transmittance);
    } else {
      radiance = GetSkyRadiance(atm, ${u('transmittance')}, ${u('scattering')}, ${u('scattering')},
        p0, dir, 0.0, ${u('sunDir')}, transmittance);
      // Диск солнца только под небом: импостор звезды пишет глубину, под ним hitSurface
      if (dot(dir, ${u('sunDir')}) > ${u('sunSize')}.y) {
        radiance += transmittance * GetSolarRadianceFor(atm);
      }
    }

    if (uDebugView > 0.5) {
      color = uDebugView < 1.5 ? radiance * ${u('exposure')}
            : uDebugView < 2.5 ? transmittance
            : vec3(1.0 - dot(transmittance, vec3(1.0 / 3.0)));
      return;
    }

    // Линейный HDR-выход; колено сжимает только избыток над 1.0; потолок 64
    // держит half-float буфер от переполнения на диске солнца
    vec3 scatter = radiance * ${u('exposure')};
    vec3 excess = max(scatter - vec3(1.0), vec3(0.0));
    scatter = min(scatter, vec3(1.0)) + excess * ${u('hdrKnee')};
    scatter = min(scatter, vec3(64.0));

    color = color * transmittance + scatter;
  }
  `
}

/**
 * Общая для слотов радиантность диска: solar_irradiance / (π·α²).
 * buildLayer живёт в atmosphereParametric.ts (меш-материал), в ядре его нет —
 * объявляем здесь. Блок идёт после ядра (нужны типы) и до слотов (они зовут).
 */
const SOLAR_RADIANCE_GLSL = /* glsl */ `
  vec3 GetSolarRadianceFor(AtmosphereParameters atm) {
    return atm.solar_irradiance / (PI * atm.sun_angular_radius * atm.sun_angular_radius);
  }

  DensityProfileLayer buildLayer(float params[5]) {
    return DensityProfileLayer(params[0], params[1], params[2], params[3], params[4]);
  }
`

export function buildAtmosphereEffectFragment(): string {
  const slots = Array.from({ length: ATMOSPHERE_SLOTS }, (_, i) => buildSlotGlsl(i)).join('\n')
  const calls = Array.from(
    { length: ATMOSPHERE_SLOTS },
    (_, i) => `    if (uCount > ${i}) applySlot${i}(dirWorld, distKm, color);`
  ).join('\n')

  return /* glsl */ `
  precision highp sampler3D;

  uniform int uCount;
  uniform mat4 uCameraWorldMatrix;
  uniform mat4 uProjectionInverse;
  uniform float uLogFarFactor;
  uniform float uInverseSpaceScale;
  uniform float uDebugView;

  ${buildAtmosphereCoreGlsl()}
  ${SOLAR_RADIANCE_GLSL}
  ${slots}

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (uCount == 0) { outputColor = inputColor; return; }

    // Луч через пиксель: обратная проекция в view, поворот в мир (без переноса).
    // clip.z = 0, а НЕ 1: у обратной проекции строка w — это
    // (z·(n−far) + (n+far))/(2·far·n), и на дальней плоскости два слагаемых
    // порядка 5·10⁵ гасят друг друга до ~7·10⁻⁹ — в float32 это ноль, деление
    // на него даёт NaN во всём кадре (замер 2026-08-21, near 1e-6, far 1.5e8).
    // Точка на ближней плоскости лежит на том же луче из начала координат.
    vec4 clip = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    vec4 viewH = uProjectionInverse * clip;
    vec3 dirView = normalize(viewH.xyz / viewH.w);
    vec3 dirWorld = normalize(mat3(uCameraWorldMatrix) * dirView);

    // Лог-глубина three: z = log2(1 + w)/log2(far + 1), w вдоль ОСИ камеры.
    // Свой декод: readDepth postprocessing идёт через cameraFar и теряет точность.
    float z = texture2D(depthBuffer, uv).r;
    float distKm;
    if (z >= 1.0 - 1e-6) {
      distKm = 1e30;
    } else {
      float w = exp2(z * uLogFarFactor) - 1.0;
      distKm = (w / max(-dirView.z, 1e-6)) * uInverseSpaceScale;
    }

    if (uDebugView > 3.5) {
      float g = z >= 1.0 - 1e-6 ? 0.0 : log(1.0 + distKm) / log(1.0 + 1.0e6);
      outputColor = vec4(vec3(g), 1.0);
      return;
    }

    vec3 color = inputColor.rgb;
${calls}

    outputColor = vec4(color, inputColor.a);
  }
${CORE_MACROS_CLEANUP_GLSL}
  `
}
