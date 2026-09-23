import { AdditiveBlending, BackSide, Color, ShaderChunk, ShaderMaterial, Vector2, Vector3 } from 'three'
import { ringDustRaymarchFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { sceneDepthFunctions, sceneDepthUniforms } from '@/core/materials/shaders/lib/chunks/SceneDepth'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'
import type { Actor } from '@/core/models/Actor'
import { resolveLightTint } from '@/core/helpers/lightSource'

/**
 * RingDustRaymarchMaterial — аддитивное пылевое гало кольца (реймарч).
 *
 * Рендерится на ОХВАТЫВАЮЩЕЙ прокси-сфере (BackSide, radius ≥ outerRadius):
 * фрагмент задаёт ТОЛЬКО направление луча, интервалы интегрирования находятся
 * аналитически (внешний цилиндр минус дыра, обрезка по вертикальной оболочке
 * 12H). Сфера гарантирует полное покрытие пикселей кольца из любого ракурса —
 * тонкая шайба (v2.0) с ребра покрывала лишь узкую полосу и давала «брус» из
 * собственных граней; сфера этого артефакта лишена.
 *
 * Блендинг АДДИТИВНЫЙ (порядок прозрачных не важен, гало не даёт «бруса»),
 * depthWrite OFF и depthTest OFF: перекрытие считает сам марш.
 *
 * Перекрытие — по ГЛУБИНЕ СЦЕНЫ, а не аппаратным тестом. Один фрагмент прокси
 * несёт интеграл вдоль всего луча, и бинарный тест не умеет «пыль до камня
 * есть, за камнем нет»: с глубиной дальней стенки прокси гало целиком срезали
 * камни, плотные тексели кольца и планета; с глубиной точки входа в слой —
 * целиком пропускали вместе с пылью ЗА ними, и планета в дыре кольца с камнями
 * внутри слоя просвечивали. Поэтому материал рисуется пассом DepthVolumePass после
 * сцены и режет оба пыльных интервала по tScene из общего чанка SceneDepth
 * (копия depth-текстуры, декод лог-глубины three, перевод в параметр луча).
 * Луч, упёршийся в поверхность до входа в слой, схлопывается в пустой
 * интервал и уходит в discard.
 *
 * Марш идёт только внутри пыльных интервалов (не жжём шаги на пустоте):
 * фиксированный бюджет шагов, IGN-джиттер против бандинга, early-exit по
 * насыщению. Плотность аналитическая (~5 ALU) — 3D-текстура не нужна; марш
 * выбран как точка расширения под будущие «клочья» (см. спеку v2).
 *
 * Модель плотности — общая с материалами камней (чанк RingDust).
 *
 * CPU-зеркало цикла марша: tauMarch в tests/ringDust/tauMirror.ts —
 * менять строго синхронно.
 *
 * Клочья (DUST_CLUMPS) — низкочастотный шум плотности только в марше объёма;
 * замкнутая форма тумана на камнях (ringDustTauRay) шум не видит, поэтому
 * система и с объёмом, и с туманом камней разом дала бы шов на границе —
 * у пояса туман камней выключен, у колец клочья не используются.
 *
 * Фазовый свет (DUST_PHASE_HG) — форвард-скаттеринг: дымка ярче, если луч
 * смотрит сквозь неё на звезду, и темнее, если от звезды. Фаза Хеньи-Гринштейна
 * взята БЕЗ множителя 1/(4π): среднее по всем направлениям сферы равно 1 по
 * построению, поэтому средняя яркость дымки не смещается — меняется только
 * распределение по направлению луча. При дефолте uDustPhaseG = 0.55 отношение
 * вперёд/назад к среднему ≈ 7.65 / 0.19.
 */
interface RingDustRaymarchOptions {
  /**
   * Светило в начале ring-local (пояс вокруг звезды): прямой лепесток дымки
   * считается по направлению на звезду из каждой точки марша, а не по
   * uDustLightDirRing. Кольца у планеты — false: текст программы прежний.
   */
  lightAtOrigin?: boolean
  /**
   * Низкочастотная модуляция плотности («клочья»): под дефайном, чтобы текст
   * программы колец оставался байт-в-байт прежним без флага.
   */
  clumps?: boolean
  /**
   * Фазовая функция Хеньи-Гринштейна («фазовый свет»): под дефайном, чтобы
   * текст программы без флага оставался байт-в-байт прежним.
   */
  phaseHG?: boolean
}

class RingDustRaymarchMaterial extends ShaderMaterial {
  /**
   * `model` — актор кольца (тот же вход, что у камней; резолвер сам
   * поднимается к корню дерева); `undefined` — тинт выключен.
   */
  public constructor(model?: Actor, options: RingDustRaymarchOptions = {}) {
    const lightTint = model ? resolveLightTint(model) : { active: false, color: new Color(1, 1, 1) }

    // Клочья вставляются строковой композицией (не голым #ifdef в базовом
    // тексте): без options.clumps текст фрагментного шейдера остаётся
    // байт-в-байт прежним — кольца программу не меняют.
    const clumpDeclChunk = options.clumps
      ? `
        uniform float uDustClumpStrength;
        uniform float uDustClumpScale;
        ${noiseFunctions}`
      : ''
    const clumpContribChunk = options.clumps
      ? `
            #ifdef DUST_CLUMPS
              // Шаг марша крупнее половины клочка — клочья не сэмплируются и
              // вырождались бы в пиксельную крупу; гасим их силу до ровной
              // дымки (среднее шума единица) и не считаем шум вовсе. Вдоль
              // ленты шаг в единицы а.е., сверху — сотые доли: клочья видны там,
              // где их можно разрешить
              float clumpGain = uDustClumpStrength * clamp(uDustClumpScale / (2.0 * dt), 0.0, 1.0);
              if (clumpGain > 0.001) {
                // p — float32 ring-local до ~4e6 units; при масштабе клочьев
                // в десятки тысяч units аргумент шума порядка сотни. Масштабы
                // ниже ~100 units начнут алиасить
                vec3 clumpP = p / uDustClumpScale;
                float clumpNoise = snoise(clumpP) + 0.5 * snoise(clumpP * 2.0);
                float n = clumpNoise * 0.5 + 0.5;
                contrib *= mix(1.0 - clumpGain, 1.0 + clumpGain, n);
              }
            #endif`
      : ''

    // Фазовый свет вставляется тем же приёмом: без options.phaseHG текст
    // фрагментного шейдера остаётся байт-в-байт прежним.
    const phaseDeclChunk = options.phaseHG
      ? `
        uniform float uDustPhaseG;
        uniform float uDustPhaseStrength;
        uniform vec3 uDustColorForward;

        // HG без 1/(4π): среднее по сфере ровно 1, средняя яркость дымки не меняется
        float ringDustPhaseHG(float cosTheta) {
          float g = uDustPhaseG;
          float g2 = g * g;
          return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5);
        }`
      : ''
    const phaseTauDeclChunk = options.phaseHG
      ? `
          #ifdef DUST_PHASE_HG
            float phaseTau = 0.0; // τ, взвешенный фазой HG (среднее по сфере = 1 по построению)
          #endif`
      : ''
    // Вычисляется рядом с клочьями (contrib уже несёт их множитель) и до
    // tau/litTau — направление на звезду своё в каждой точке марша при
    // DUST_LIGHT_AT_ORIGIN, тот же смысл что toStar ниже по коду (не тот же
    // токен: та переменная объявлена позже своего ifdef-блока)
    const phaseContribChunk = options.phaseHG
      ? `
            #ifdef DUST_PHASE_HG
              #ifdef DUST_LIGHT_AT_ORIGIN
                float cosTheta = dot(rayDir, -p / max(length(p), 1e-6));
              #else
                float cosTheta = dot(rayDir, uDustLightDirRing);
              #endif
              phaseTau += contrib * ringDustPhaseHG(cosTheta);
            #endif`
      : ''
    // Переопределяет haze поверх существующей ветки DUST_LIGHT_AT_ORIGIN/else:
    // тон дымки смещается к uDustColorForward, яркость — к среднему HG вдоль луча
    const phaseHazeOverrideChunk = options.phaseHG
      ? `
          #ifdef DUST_PHASE_HG
            // Среднее HG по лучу: 1 нейтрально, >1 форвард (к звезде), <1 назад
            float phaseMean = tau > 0.0 ? phaseTau / tau : 1.0;
            float forward = clamp((phaseMean - 1.0) / 3.0, 0.0, 1.0);
            haze = mix(uDustColor, uDustColorForward, forward) * mix(1.0, phaseMean, uDustPhaseStrength);
            #ifdef USE_LIGHT_TINT
              haze *= uLightColor;
            #endif
          #endif`
      : ''

    super({
      defines: {
        ...(lightTint.active && { USE_LIGHT_TINT: '1' }),
        ...(options.lightAtOrigin && { DUST_LIGHT_AT_ORIGIN: '1' }),
        ...(options.clumps && { DUST_CLUMPS: '1' }),
        ...(options.phaseHG && { DUST_PHASE_HG: '1' })
      },
      uniforms: {
        uDustColor: { value: new Color(0x9b968c) },
        // Цвет света звезды (lightTint) — per-instance объект, не общий модульный Uniform
        uLightColor: { value: new Color(1, 1, 1).copy(lightTint.color) },
        uDustDensity: { value: 0.0 },
        uDustScaleHeight: { value: 1.0 },
        uDustRingInner: { value: 0.0 },
        uDustRingOuter: { value: 1e9 },
        uDustCamRingPos: { value: new Vector3() },
        uDustLightDirRing: { value: new Vector3(1, 0, 0) },
        /** Крутизна гейта по углу обзора (спека: дефолт 2) */
        uDustAnglePower: { value: 2.0 },
        /** Дистанция полного проявления пыли, three-units */
        uDustNearFade: { value: 20.0 },
        /** Бюджет шагов марша */
        uDustMaxSteps: { value: 16 },
        /** Радиус планеты в ring-local three-units (0 — тень выключена) */
        uDustPlanetRadius: { value: 0.0 },
        /** Радиальный профиль пыли из альфы текстуры кольца (см. DustRadialProfile) */
        uDustRadialMap: { value: null },
        /** Множитель профиля (среднее модуляции ≈ 1); 0 — профиль выключен */
        uDustRadialMapScale: { value: 0.0 },
        // Полосы кольца и слой (см. чанк RingDust): самозатенение марша
        uRingBandMap: { value: null },
        uRingBandEnabled: { value: 0.0 },
        uBandMeanColor: { value: new Vector3(1, 1, 1) },
        uBandTintStrength: { value: 1.0 },
        uLayerHalfThickness: { value: 1.0 },
        uLayerShadowStrength: { value: 0.25 },
        /** Диагностика: 0 выкл, 1 τ, 2 alpha, 3 гейт, 4 теплокарта шагов */
        uDustDebugMode: { value: 0 },
        /** Сила клочьев 0..1 (нейтрально при DUST_CLUMPS выключенном) */
        uDustClumpStrength: { value: 0.0 },
        /** Масштаб шума клочьев, three-units; p/scale ~1e4 — вне алиасинга */
        uDustClumpScale: { value: 1.0 },
        /** Асимметрия фазы HG, [-1, 1) (нейтрально при DUST_PHASE_HG выключенном) */
        uDustPhaseG: { value: 0.55 },
        /** Сила подмеса фазы 0..1; 0 — эффект на яркость выключен */
        uDustPhaseStrength: { value: 0.0 },
        /** Цвет дымки при взгляде на звезду (форвард-пик фазы) */
        uDustColorForward: { value: new Color(0x9b968c) },
        // Глубина сцены (чанк SceneDepth): привязывает DepthVolumePass перед рендером
        uSceneDepth: { value: null },
        uResolution: { value: new Vector2(1, 1) },
        uLogFarFactor: { value: 1.0 },
        uSceneDepthEnabled: { value: 0.0 }
      },
      vertexShader: /* glsl */ `
        ${ShaderChunk.common}

        varying vec3 vRingPos;

        void main() {
          // Геометрия запечена в ring-local space (см. RingDustVolume)
          vRingPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${ShaderChunk.common}

        #ifdef USE_LIGHT_TINT
          uniform vec3 uLightColor;
        #endif

        ${ringDustUniforms}
        ${ringDustRaymarchFunctions}

        uniform int uDustMaxSteps;
        uniform int uDustDebugMode;
        ${sceneDepthUniforms}${clumpDeclChunk}${phaseDeclChunk}

        // Во фрагментном префиксе three modelViewMatrix не объявлен, но рендерер
        // грузит его по имени в любой стадии. Берём именно его, а не
        // viewMatrix * modelMatrix: он camera-relative и не теряет точность
        // на межпланетных координатах.
        uniform mat4 modelViewMatrix;

        ${sceneDepthFunctions}

        varying vec3 vRingPos;

        // Теплокарта для диагностических режимов: синий → зелёный → красный
        vec3 dustDebugHeat(float x) {
          x = clamp(x, 0.0, 1.0);
          vec3 cold = mix(vec3(0.0, 0.1, 0.9), vec3(0.0, 0.9, 0.2), smoothstep(0.0, 0.5, x));
          return mix(cold, vec3(0.95, 0.15, 0.05), smoothstep(0.5, 1.0, x));
        }

        void main() {
          // Фрагмент прокси задаёт только направление луча
          vec3 rayDir = normalize(vRingPos - uDustCamRingPos);
          float gate = ringDustAngleGate(rayDir);
          if (uDustDebugMode == 0 && gate <= 0.0005) discard;

          // Пыльные интервалы: внешний цилиндр минус дыра кольца
          vec2 outerIv = ringDustCircleInterval(uDustCamRingPos, rayDir, uDustRingOuter);
          float o0 = max(outerIv.x, 0.0);
          float o1 = outerIv.y;
          if (o1 <= o0) discard;
          vec2 innerIv = ringDustCircleInterval(uDustCamRingPos, rayDir, uDustRingInner);
          float h0 = max(innerIv.x, o0);
          float h1 = min(innerIv.y, o1);
          bool hasHole = h1 > h0;
          vec2 segA = hasHole ? vec2(o0, h0) : vec2(o0, o1);
          vec2 segB = hasHole ? vec2(h1, o1) : vec2(0.0, -1.0);

          // Обрезка по вертикальной оболочке |y| <= 12H (за ней плотность пренебрежима)
          float slabHalf = uDustScaleHeight * 12.0;
          if (abs(rayDir.y) > 1e-8) {
            float tA = (-slabHalf - uDustCamRingPos.y) / rayDir.y;
            float tB = ( slabHalf - uDustCamRingPos.y) / rayDir.y;
            float s0 = min(tA, tB);
            float s1 = max(tA, tB);
            segA = vec2(max(segA.x, s0), min(segA.y, s1));
            segB = vec2(max(segB.x, s0), min(segB.y, s1));
          }

          // Обрыв по глубине сцены: пыль за камнем, планетой и плотным текселем
          // кольца в τ не попадает. Луч, упёршийся в поверхность до входа в слой,
          // схлопывает оба интервала и уходит в discard ниже.
          float tScene = sceneDepthRayT(mat3(modelViewMatrix) * rayDir);
          segA.y = min(segA.y, tScene);
          segB.y = min(segB.y, tScene);

          float lenA = max(segA.y - segA.x, 0.0);
          float lenB = max(segB.y - segB.x, 0.0);
          float total = lenA + lenB;
          if (total <= 0.0) discard;

          float steps = float(uDustMaxSteps);
          float dt = total / steps;
          // Interleaved Gradient Noise — пер-пиксельный джиттер против бандинга
          float jitter = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));

          float tau = 0.0;
          float litTau = 0.0; // τ, взвешенный тенью планеты (для цвета, не для alpha)
          #ifdef DUST_LIGHT_AT_ORIGIN
            float sunTau = 0.0; // τ, взвешенный прямым лепестком к звезде в начале координат
          #endif${phaseTauDeclChunk}
          float marched = 0.0;
          // 64 — жёсткий потолок GLSL-цикла (граница обязана быть константой):
          // uDustMaxSteps выше 64 молча обрезается. CPU-зеркало tauMarch потолка
          // не имеет — при сверке держать steps <= 64.
          for (int i = 0; i < 64; i++) {
            if (float(i) >= steps) break;
            float s = (float(i) + jitter) * dt;
            float t = s < lenA ? segA.x + s : segB.x + (s - lenA);
            vec3 p = uDustCamRingPos + rayDir * t;
            float contrib = ringDustDensityAt(p) * ringDustNearRamp(t) * dt;${clumpContribChunk}${phaseContribChunk}
            tau += contrib;
            // Тень планеты и самозатенение слоя кольца — на каждом шаге
            litTau += contrib * ringDustPlanetShadow(p) * ringLayerShadow(p);
            #ifdef DUST_LIGHT_AT_ORIGIN
              // Звезда в начале ring-local: направление на неё своё в каждой точке марша
              vec3 toStar = -p / max(length(p), 1e-6);
              sunTau += contrib * pow(max(dot(rayDir, toStar), 0.0), 4.0);
            #endif
            marched = float(i) + 1.0;
            // early-exit: насыщение непрозрачности
            if (1.0 - exp(-tau) > 0.995) break;
          }

          float alpha = (1.0 - exp(-tau)) * gate;
          // Освещённая доля τ: средняя тень планеты, взвешенная плотностью вдоль луча
          float litFrac = tau > 0.0 ? litTau / tau : 1.0;

          if (uDustDebugMode != 0) {
            // Диагностика рисуется непрозрачно, поверх всего содержимого объёма
            vec3 dbg = vec3(0.0);
            if (uDustDebugMode == 1) dbg = dustDebugHeat(1.0 - exp(-tau));
            else if (uDustDebugMode == 2) dbg = dustDebugHeat(alpha);
            else if (uDustDebugMode == 3) dbg = dustDebugHeat(gate);
            else if (uDustDebugMode == 4) dbg = dustDebugHeat(marched / steps);
            gl_FragColor = vec4(dbg, 1.0);
            return;
          }

          if (alpha < 0.003) discard;
          // Аддитивный вклад: премультиплай альфой уже делает блендер
          // (SrcAlpha, One), поэтому цвет отдаём как есть, интенсивность в alpha.
          // Тень планеты затемняет цвет (litFrac), но не непрозрачность (alpha)
          #ifdef DUST_LIGHT_AT_ORIGIN
            vec3 haze = ringDustHazeSun(tau > 0.0 ? sunTau / tau : 0.0);
          #else
            vec3 haze = ringDustHaze(rayDir);
          #endif${phaseHazeOverrideChunk}
          gl_FragColor = vec4(haze * litFrac, alpha);
        }
      `,
      side: BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending
    })
  }
}

export { RingDustRaymarchMaterial }
export type { RingDustRaymarchOptions }
