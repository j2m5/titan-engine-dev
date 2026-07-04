import { AdditiveBlending, BackSide, Color, ShaderChunk, ShaderMaterial, Vector3 } from 'three'
import { ringDustRaymarchFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'

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
 * depthWrite OFF (не блокирует другие прозрачные), depthTest ON: планета
 * корректно перекрывает гало — дым не просвечивает сквозь неё. Гало над
 * пустотой и 2D-текстурой кольца рисуется поверх (тест глубины проходит).
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
 */
class RingDustRaymarchMaterial extends ShaderMaterial {
  public constructor() {
    super({
      uniforms: {
        uDustColor: { value: new Color(0x9b968c) },
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
        /** Диагностика: 0 выкл, 1 τ, 2 alpha, 3 гейт, 4 теплокарта шагов */
        uDustDebugMode: { value: 0 }
      },
      vertexShader: /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_vertex}

        varying vec3 vRingPos;

        void main() {
          // Геометрия запечена в ring-local space (см. RingDustVolume)
          vRingPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

          ${ShaderChunk.logdepthbuf_vertex}
        }
      `,
      fragmentShader: /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_fragment}

        ${ringDustUniforms}
        ${ringDustRaymarchFunctions}

        uniform int uDustMaxSteps;
        uniform int uDustDebugMode;

        varying vec3 vRingPos;

        // Теплокарта для диагностических режимов: синий → зелёный → красный
        vec3 dustDebugHeat(float x) {
          x = clamp(x, 0.0, 1.0);
          vec3 cold = mix(vec3(0.0, 0.1, 0.9), vec3(0.0, 0.9, 0.2), smoothstep(0.0, 0.5, x));
          return mix(cold, vec3(0.95, 0.15, 0.05), smoothstep(0.5, 1.0, x));
        }

        void main() {
          ${ShaderChunk.logdepthbuf_fragment}

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
          float marched = 0.0;
          // 64 — жёсткий потолок GLSL-цикла (граница обязана быть константой):
          // uDustMaxSteps выше 64 молча обрезается. CPU-зеркало tauMarch потолка
          // не имеет — при сверке держать steps <= 64.
          for (int i = 0; i < 64; i++) {
            if (float(i) >= steps) break;
            float s = (float(i) + jitter) * dt;
            float t = s < lenA ? segA.x + s : segB.x + (s - lenA);
            vec3 p = uDustCamRingPos + rayDir * t;
            float contrib = ringDustDensityAt(p) * ringDustNearRamp(t) * dt;
            tau += contrib;
            litTau += contrib * ringDustPlanetShadow(p);
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
          gl_FragColor = vec4(ringDustHaze(rayDir) * litFrac, alpha);
        }
      `,
      side: BackSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending
    })
  }
}

export { RingDustRaymarchMaterial }
