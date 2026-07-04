/**
 * RingDust — единая GLSL-модель пылевой дымки детального астероидного кольца.
 *
 * Используется в трёх материалах (обязательно одна и та же модель, иначе виден шов
 * между туманом на камнях и объёмной дымкой):
 * - InstancedAsteroidShaderTemplate (L0) — через #include <ringDustUniforms/ringDustFunctions>
 * - BillboardAsteroidMaterial (L1) — интерполяцией строк
 * - RingDustRaymarchMaterial (объём дымки) — интерполяцией строк
 *
 * Все координаты — в ring-local space системы кольца: плоскость кольца XZ, нормаль Y.
 *
 * Оптическая толща считается АНАЛИТИЧЕСКИ вдоль луча (без сэмплирования вдоль
 * отрезка): радиальные интервалы через пересечение с цилиндрами кольца (дыра
 * вычитается), вертикальная экспонента — в замкнутой форме, маска кромок —
 * тапами по квантилям экспоненциальной массы.
 *
 * CPU-зеркало: tests/ringDust/tauMirror.ts — менять строго синхронно
 * (тесты точности RingDustTauAccuracy.spec.ts сверяют зеркало с плотным
 * численным интегралом; GLSL обязан повторять зеркало один в один).
 *
 * v2: добавлен марш объёма для новой пылевой дымки детального кольца —
 * `ringDustDensityAt` сэмплируется пошагово вдоль луча (см. RingDustRaymarchMaterial),
 * тогда как непрозрачная геометрия камней (L0/L1) по-прежнему использует
 * замкнутую форму `ringDustTauRay`. Гейт по углу (`ringDustAngleGate`) и
 * ближний рамп (`ringDustNearRamp`) применяются в обоих путях одинаково,
 * поэтому шов между объёмной дымкой и туманом на камнях не виден.
 */

export const ringDustUniforms = `
  uniform vec3 uDustColor;
  uniform float uDustDensity;
  uniform float uDustScaleHeight;
  uniform float uDustRingInner;
  uniform float uDustRingOuter;
  uniform vec3 uDustCamRingPos;
  uniform vec3 uDustLightDirRing;
  uniform float uDustAnglePower;
  uniform float uDustNearFade;
`

// Общее ядро модели: плотность, гейт, рамп, интервалы, цвет дымки.
// Достаточно для реймарша объёма; закрытая форма (ниже) строится поверх него.
const ringDustCoreGlsl = `
  // Маска кромок кольца
  float ringDustRadialMask(float r) {
    float edge = (uDustRingOuter - uDustRingInner) * 0.12;
    return smoothstep(uDustRingInner, uDustRingInner + edge, r)
         * (1.0 - smoothstep(uDustRingOuter - edge, uDustRingOuter, r));
  }

  // Плотность пыли в точке ring-local space (сэмплируется маршем объёма)
  float ringDustDensityAt(vec3 p) {
    float safeH = max(uDustScaleHeight, 1e-6);
    return uDustDensity * ringDustRadialMask(length(p.xz)) * exp(-abs(p.y) / safeH);
  }

  // Гейт по углу луча к плоскости кольца: 1 на скользящем, строго 0 при 90°.
  // Нефизичный, осознанный: лечит «тусклую пелену сверху» (см. спеку v2)
  float ringDustAngleGate(vec3 dir) {
    return pow(max(1.0 - abs(dir.y), 0.0), uDustAnglePower);
  }

  // Рамп ближней дистанции: вблизи камеры пыль не проявляется
  float ringDustNearRamp(float t) {
    return smoothstep(0.0, max(uDustNearFade, 1e-6), t);
  }

  // Интервал t, где луч (в проекции XZ) внутри цилиндра радиуса R.
  // Пустой интервал кодируется как vec2(1.0, 0.0)
  vec2 ringDustCircleInterval(vec3 o, vec3 d, float R) {
    float a = dot(d.xz, d.xz);
    if (a < 1e-12) {
      // Вертикальный луч: внутри цилиндра целиком либо никогда
      return length(o.xz) <= R ? vec2(-1.0e9, 1.0e9) : vec2(1.0, 0.0);
    }
    float b = dot(o.xz, d.xz);
    float c = dot(o.xz, o.xz) - R * R;
    float disc = b * b - a * c;
    if (disc <= 0.0) return vec2(1.0, 0.0);
    float sq = sqrt(disc);
    return vec2((-b - sq) / a, (-b + sq) / a);
  }

  // Цвет дымки: базовый + мягкий forward-scattering буст в сторону звезды
  vec3 ringDustHaze(vec3 rayDir) {
    float sun = pow(max(dot(rayDir, uDustLightDirRing), 0.0), 4.0);
    return uDustColor * (0.75 + 0.45 * sun);
  }
`

// Закрытая форма оптической толщи (камни L0/L1): строится поверх ядра,
// объёмный реймарч её не включает (см. RingDustRaymarchMaterial)
const ringDustClosedFormGlsl = `
  float ringDustMaskAtT(vec3 o, vec3 d, float t) {
    return ringDustRadialMask(length(o.xz + d.xz * t));
  }

  // Нечётная первообразная exp(-|u|/H): F(u) = sign(u) * H * (1 - exp(-|u|/H))
  float ringDustF(float u) {
    // защита от деления на ноль
    float safeH = max(uDustScaleHeight, 1e-6);
    float f = safeH * (1.0 - exp(-abs(u) / safeH));
    return u >= 0.0 ? f : -f;
  }

  // Замкнутая форма интеграла exp(-|y(t)|/H) dt по [t0, t1], y(t) = oy + dy*t
  float ringDustVerticalIntegral(float oy, float dy, float t0, float t1) {
    if (t1 <= t0) return 0.0;
    if (abs(dy) < 1e-8) {
      float safeH = max(uDustScaleHeight, 1e-6);
      return exp(-abs(oy) / safeH) * (t1 - t0);
    }
    float ya = oy + dy * t0;
    float yb = oy + dy * t1;
    return (ringDustF(max(ya, yb)) - ringDustF(min(ya, yb))) / abs(dy);
  }

  // Средняя маска кромок по куску с монотонным |y(t)|: тапы по квантилям
  // экспоненциальной массы (важностная выборка — маска сэмплируется там,
  // где сосредоточен вклад в интеграл)
  float ringDustPieceMask(vec3 o, vec3 d, float t0, float t1) {
    float L = t1 - t0;
    float absDy = abs(d.y);
    if (absDy < 1e-8) {
      return 0.25 * (ringDustMaskAtT(o, d, t0 + L * 0.125)
                   + ringDustMaskAtT(o, d, t0 + L * 0.375)
                   + ringDustMaskAtT(o, d, t0 + L * 0.625)
                   + ringDustMaskAtT(o, d, t0 + L * 0.875));
    }
    float ya = abs(o.y + d.y * t0);
    float yb = abs(o.y + d.y * t1);
    // Масса концентрируется у конца с меньшим |y|
    float tNear = ya <= yb ? t0 : t1;
    float dirSign = ya <= yb ? 1.0 : -1.0;
    float safeH = max(uDustScaleHeight, 1e-6);
    float lambda = safeH / absDy;
    float A = max(1.0 - exp(-L / lambda), 1e-6);
    vec4 dist = -lambda * log(vec4(1.0) - vec4(0.125, 0.375, 0.625, 0.875) * A);
    vec4 tq = vec4(tNear) + dirSign * min(dist, vec4(L));
    return 0.25 * (ringDustMaskAtT(o, d, tq.x) + ringDustMaskAtT(o, d, tq.y)
                 + ringDustMaskAtT(o, d, tq.z) + ringDustMaskAtT(o, d, tq.w));
  }

  // Вклад одного радиального интервала: разрез по пересечению средней плоскости,
  // в каждом куске |y| монотонно
  float ringDustIntervalTau(vec3 o, vec3 d, float t0, float t1) {
    if (t1 <= t0) return 0.0;
    float tCross = -1.0;
    if (abs(d.y) >= 1e-8) tCross = -o.y / d.y;
    if (tCross > t0 && tCross < t1) {
      return uDustDensity * (
        ringDustPieceMask(o, d, t0, tCross) * ringDustVerticalIntegral(o.y, d.y, t0, tCross) +
        ringDustPieceMask(o, d, tCross, t1) * ringDustVerticalIntegral(o.y, d.y, tCross, t1));
    }
    return uDustDensity * ringDustPieceMask(o, d, t0, t1) * ringDustVerticalIntegral(o.y, d.y, t0, t1);
  }

  // Оптическая толща вдоль луча origin + dir*t, t in [0, tMax]; dir нормирован.
  // Фрагмент прокси задаёт ТОЛЬКО направление луча — tau зависит лишь от
  // (камера, направление), поэтому разрывов на гранях прокси-оболочки быть
  // не может, а дыра кольца учитывается вычитанием интервала внутреннего
  // цилиндра (пыль на дальней стороне не теряется).
  // dustSpan — объединённый диапазон пыли вдоль луча (якоря для шума).
  float ringDustTauRay(vec3 origin, vec3 dir, float tMax, out vec2 dustSpan) {
    dustSpan = vec2(0.0);
    vec2 outer = ringDustCircleInterval(origin, dir, uDustRingOuter);
    float o0 = max(outer.x, 0.0);
    float o1 = min(outer.y, tMax);
    if (o1 <= o0) return 0.0;

    // Дыра кольца вычитается
    vec2 inner = ringDustCircleInterval(origin, dir, uDustRingInner);
    float h0 = max(inner.x, o0);
    float h1 = min(inner.y, o1);

    dustSpan = vec2(o0, o1);
    if (h1 <= h0) {
      return ringDustIntervalTau(origin, dir, o0, o1);
    }
    return ringDustIntervalTau(origin, dir, o0, h0) + ringDustIntervalTau(origin, dir, h1, o1);
  }

  // Аэроперспектива для непрозрачной геометрии (камни L0/L1)
  vec3 ringDustApplyFog(vec3 baseColor, vec3 fragRingPos) {
    vec3 delta = fragRingPos - uDustCamRingPos;
    float dist = length(delta);
    if (dist < 1e-6) return baseColor;
    vec3 rayDir = delta / dist;
    vec2 span;
    float tau = ringDustTauRay(uDustCamRingPos, rayDir, dist, span);
    if (tau <= 0.0) return baseColor;
    float fogAmount = (1.0 - exp(-tau)) * ringDustAngleGate(rayDir) * ringDustNearRamp(dist);
    return mix(baseColor, ringDustHaze(rayDir), fogAmount);
  }
`

// Подмножество для реймарша объёма: только ядро, без закрытой формы
export const ringDustRaymarchFunctions = ringDustCoreGlsl

// Полный набор для камней L0/L1: ядро + закрытая форма (каждая функция
// определена ровно один раз — расхождение копий исключено композицией)
export const ringDustFunctions = ringDustCoreGlsl + ringDustClosedFormGlsl
