/**
 * Шейдеры конвейера запекания облачного поля.
 *
 * Числовое зеркало потока: tests/brownDwarf/brownDwarfFlowMirror.ts —
 * менять строго синхронно.
 *
 * PI используется ниже (bdFlow, seedFragmentShader), но не объявлена здесь:
 * это RawShaderMaterial без автоподключения ShaderChunk — её прописывает
 * `#define PI ...`, который BrownDwarfCloudBaker добавляет перед исходником
 * в seedMaterial()/advectMaterial().
 */

/**
 * Поле потока: зональные струи плюс вихри. Обе части строятся векторным
 * произведением с самим направлением, поэтому касательны к сфере по
 * построению — полулагранжев снос не уводит выборку с единичной сферы.
 */
export const bdFlowChunk = `
  #define POLE_EPSILON 1e-4

  // Восточный вектор. На полюсах cross с осью Y вырождается в ноль, и
  // normalize дал бы NaN — защита обязана стоять ДО нормализации.
  vec3 bdEast(vec3 dir) {
    vec3 east = cross(vec3(0.0, 1.0, 0.0), dir);

    return dot(east, east) < POLE_EPSILON * POLE_EPSILON ? vec3(0.0) : normalize(east);
  }

  float bdPotential(vec3 dir, float seed) {
    return sin(dir.x * 3.1 + seed) * cos(dir.y * 2.7 - seed) * sin(dir.z * 3.7 + seed * 0.5);
  }

  vec3 bdPotentialGradient(vec3 dir, float seed) {
    float h = 1e-3;

    return vec3(
      (bdPotential(dir + vec3(h, 0.0, 0.0), seed) - bdPotential(dir - vec3(h, 0.0, 0.0), seed)) / (2.0 * h),
      (bdPotential(dir + vec3(0.0, h, 0.0), seed) - bdPotential(dir - vec3(0.0, h, 0.0), seed)) / (2.0 * h),
      (bdPotential(dir + vec3(0.0, 0.0, h), seed) - bdPotential(dir - vec3(0.0, 0.0, h), seed)) / (2.0 * h)
    );
  }

  // Струи: sin по широте даёт чередование направлений от пояса к поясу,
  // сдвиг между соседними струями растягивает поле вдоль пояса и скручивает
  // вихри на их границах — юпитерианская механика.
  vec3 bdFlow(vec3 dir, float bandCount, float jetStrength, float turbulence, float seed) {
    vec3 zonal = bdEast(dir) * (jetStrength * sin(dir.y * PI * bandCount));
    vec3 curl = cross(dir, bdPotentialGradient(dir, seed)) * turbulence;

    return zonal + curl;
  }
`

/**
 * Хеш-шум значений (value noise) и fbm поверх него. Общий для посева (базовое
 * поле) и адвекции (впрыск свежего шума теми же формулами) — интерполируется
 * в оба шейдера ниже, отдельной копии быть не должно.
 */
export const bdNoiseChunk = `
  float bdHash(vec3 p, float seed) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)) + seed) * 43758.5453);
  }

  float bdValueNoise(vec3 p, float seed) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n = mix(
      mix(mix(bdHash(i + vec3(0.0, 0.0, 0.0), seed), bdHash(i + vec3(1.0, 0.0, 0.0), seed), f.x),
          mix(bdHash(i + vec3(0.0, 1.0, 0.0), seed), bdHash(i + vec3(1.0, 1.0, 0.0), seed), f.x), f.y),
      mix(mix(bdHash(i + vec3(0.0, 0.0, 1.0), seed), bdHash(i + vec3(1.0, 0.0, 1.0), seed), f.x),
          mix(bdHash(i + vec3(0.0, 1.0, 1.0), seed), bdHash(i + vec3(1.0, 1.0, 1.0), seed), f.x), f.y),
      f.z);

    return n;
  }

  float bdFbm(vec3 p, float seed) {
    float total = 0.0;
    float amplitude = 1.0;
    float maxValue = 0.0;

    for (int i = 0; i < 5; i++) {
      total += bdValueNoise(p, seed) * amplitude;
      maxValue += amplitude;
      amplitude *= 0.55;
      p *= 2.0;
    }

    return total / maxValue;
  }
`

/** Общий вершинник проходов: полноэкранный квад, без матриц */
export const bakeVertexShader = `
  attribute vec3 position;
  attribute vec2 uv;

  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** Восстановление направления тексела по базису грани — общее для всех проходов */
const faceDirChunk = `
  uniform vec3 uFaceForward;
  uniform vec3 uFaceRight;
  uniform vec3 uFaceUp;

  varying vec2 vUv;

  vec3 bdFaceDir() {
    vec2 st = vUv * 2.0 - 1.0;

    return normalize(uFaceForward + st.x * uFaceRight + st.y * uFaceUp);
  }
`

/**
 * Посев: базовое поле плюс широтная организация в пояса.
 * R — толща палубы, G — высота верхушки: независимые поля с разными зёрнами,
 * которые дальше несёт ОДИН поток, поэтому они остаются согласованными.
 */
export const seedFragmentShader = `
  precision highp float;

  ${faceDirChunk}
  ${bdNoiseChunk}

  uniform float uSeed;
  uniform float uBandCount;

  void main() {
    vec3 dir = bdFaceDir();

    // Пояса задают крупную структуру, шум её ломает — дальше адвекция рвёт
    float bands = 0.5 + 0.5 * sin(dir.y * PI * uBandCount);
    float density = mix(bands, bdFbm(dir * 4.0, uSeed), 0.45);
    float height = bdFbm(dir * 6.0 + 17.0, uSeed + 91.0);

    gl_FragColor = vec4(density, height, 0.0, 1.0);
  }
`

/**
 * Адвекция: полулагранжев снос — выборка берётся НАЗАД по потоку.
 * Подмешивание свежего шума компенсирует численную диффузию билинейной
 * выборки: без него поле за два десятка шагов замыливается.
 */
export const advectFragmentShader = `
  precision highp float;

  ${faceDirChunk}
  ${bdNoiseChunk}
  ${bdFlowChunk}

  uniform samplerCube uPrev;
  uniform float uSeed;
  uniform float uBandCount;
  uniform float uJetStrength;
  uniform float uTurbulence;
  uniform float uStepSize;
  uniform float uInjection;
  uniform float uInjectSeed;

  void main() {
    vec3 dir = bdFaceDir();
    vec3 flow = bdFlow(dir, uBandCount, uJetStrength, uTurbulence, uSeed);
    vec3 back = normalize(dir - flow * uStepSize);

    vec2 advected = textureCube(uPrev, back).rg;

    // Впрыск обязан быть РАЗНЫМ на каждом шаге: одно и то же поле, влитое
    // 24 раза, складывается когерентно в призрак фиксированного fbm вместо
    // широкополосной детали. uInjectSeed несёт номер итерации — это счётчик
    // цикла запекания, а не время: тот же seed даёт ту же кубмапу.
    vec2 fresh = vec2(
      bdFbm(dir * 7.0, uSeed + 31.0 + uInjectSeed),
      bdFbm(dir * 9.0 + 5.0, uSeed + 137.0 + uInjectSeed)
    );

    gl_FragColor = vec4(mix(advected, fresh, uInjection), 0.0, 1.0);
  }
`

/** Финализация: контраст толщи; высота проходит насквозь, она уже в 0..1 */
export const finalizeFragmentShader = `
  precision highp float;

  ${faceDirChunk}

  uniform samplerCube uPrev;
  uniform float uContrast;

  void main() {
    vec2 f = textureCube(uPrev, bdFaceDir()).rg;

    // Толща остаётся нормированной 0..1: множитель opticalDepth живёт
    // юниформом тела, чтобы ручка не требовала перепекания
    float density = clamp(0.5 + (f.r - 0.5) * uContrast, 0.0, 1.0);

    gl_FragColor = vec4(density, f.g, 0.0, 1.0);
  }
`
