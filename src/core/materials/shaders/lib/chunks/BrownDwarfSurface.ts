/**
 * Формулы поверхности коричневого карлика, общие для диска
 * (BrownDwarfShaderTemplate, через #include <brownDwarfSurface>) и
 * билборда-импостора (BrownDwarfImpostorShaderTemplate) — паттерн starSurface:
 * одна формула, два LOD-потребителя, рассинхронизация невозможна без правки
 * чанка.
 *
 * Числовое зеркало: tests/brownDwarf/brownDwarfSurfaceMirror.ts — менять
 * строго синхронно.
 */
export const brownDwarfSurface = `
  #define BD_BAND_NOISE_MIX 0.35
  #define BD_GAP_MIN_WIDTH 0.004

  /** Растяжка высоты: сырой fbm держится в ±0.4, и палуба не доходила до краёв */
  #define BD_HEIGHT_CONTRAST 1.25

  /**
   * Разброс толщи палубы ВЫШЕ порога. Порог обрезает всё плотнее себя в
   * единицу, и палуба выходит ровной — хотя вихри и турбулентность в
   * плотности там ровно те же, что в светлых прогалинах. Множитель
   * возвращает их форму: плотные места непрозрачнее, разрежённые
   * пропускают чуть больше свечения снизу. Равенство единице — откат.
   */
  #define BD_DECK_RELIEF_LOW 0.85
  #define BD_DECK_RELIEF_HIGH 1.25

  #define BD_FINE_SCALE 4.0
  #define BD_FINE_OCTAVES 4

  // Высота верхушки для параллакса, отдельно и дёшево.
  // Домен НЕ коробленный: параллакс — художественный сдвиг на пару текселей,
  // и разница между точной и приближённой высотой в нём неразличима, а полный
  // bdField ради одного канала стоил бы восемнадцати лишних октав.
  float bdHeight(vec3 dir, float seed) {
    return 0.5 + 0.5 * fbm(vec4(dir * 2.76, seed + 11.0), 4, 0.7);
  }

  #define BD_VORTEX_COUNT 5

  /**
   * Овальные штормы на границах струй — там, где встречные потоки сдвигаются
   * друг о друга. Каждый вихрь проворачивает домен вокруг оси, проходящей
   * через его центр, на угол, гаснущий с угловым расстоянием (формула
   * Родрига). Тот же приём, что зональный сдвиг, но локальный: коробится
   * домен, поэтому размытия нет и времени тоже нет.
   *
   * Центры садятся на границы поясов: там sin(широта·PI·bandCount) равен нулю.
   */
  vec3 bdVortices(vec3 dir, float seed, float bandCount, float strength) {
    vec3 warped = dir;

    for (int i = 0; i < BD_VORTEX_COUNT; i++) {
      float fi = float(i);
      float h1 = fract(sin(fi * 12.9898 + seed) * 43758.5453);
      float h2 = fract(sin(fi * 78.2330 + seed * 1.7) * 43758.5453);
      float h3 = fract(sin(fi * 39.4250 + seed * 2.3) * 43758.5453);

      float band = floor(h1 * bandCount * 2.0 - bandCount) + 1.0;
      float cy = clamp(band / bandCount, -0.95, 0.95);
      float cr = sqrt(max(1.0 - cy * cy, 0.0));
      float clon = h2 * 6.2831853;
      vec3 centre = vec3(cr * cos(clon), cy, cr * sin(clon));

      float radius = 0.10 + 0.12 * h3;
      float fall = 1.0 - smoothstep(0.0, radius, distance(warped, centre));
      float angle = fall * fall * strength * (h3 > 0.5 ? 1.0 : -1.0);

      float ca = cos(angle);
      float sa = sin(angle);
      warped = warped * ca + cross(centre, warped) * sa + centre * dot(centre, warped) * (1.0 - ca);
    }

    return normalize(warped);
  }

  /**
   * Насколько глубоко видно сквозь прогалину: 1 — палуба разошлась полностью,
   * 0 — сомкнута. Берёт плотность ДО порога: после порога значение почти
   * двоичное, и градиента в нём уже нет.
   */
  float bdDepth(float density, float threshold) {
    return 1.0 - smoothstep(0.0, threshold, density);
  }

  // Полосы прибиты к широте, шум гнёт их и рвёт.
  //
  // Домен анизотропный: вдоль широты частота выше, поэтому шум меняется
  // поперёк поясов и тянется вдоль них. Четвёртая координата — СИД, а не
  // время: анимация срезом сквозь 4D-шум и была механизмом дефекта,
  // из-за которого первую версию объекта удалили.
  //
  // Порог возвращает провалы и гребни, которых не давало запекание, а его
  // полуширина растёт с экранным футпринтом: фиксированная ширина под
  // HDR-контрастом усиливает субпиксельный шум. На импосторе футпринт
  // огромен, и порог вырождается в усреднение сам.
  vec3 bdField(vec3 dir, float seed, float bandCount, float turbulence,
               float gapThreshold, float bandWarp, float zonalShear, float fineDetail,
               float polarChaos, float vortexStrength) {
    // Коробление широты: строго периодический синус давал пояса-линейку
    float warpNoise = fbm(vec4(0.0, dir.y * 2.0, 0.0, seed + 37.0), 3, 0.6);
    float lat = dir.y + warpNoise * bandWarp;

    // Зональный сдвиг: домен проворачивается вокруг оси тем сильнее, чем ближе
    // к струе, и знак чередуется с поясами. Отсюда сметённые вдоль пояса
    // складки — подпись газового гиганта. Коробится ДОМЕН, поэтому, в отличие
    // от адвекции запекания, ничего не размывается
    float shear = sin(lat * PI * bandCount) * zonalShear;
    float ca = cos(shear);
    float sa = sin(shear);
    vec3 swept = vec3(dir.x * ca - dir.z * sa, dir.y, dir.x * sa + dir.z * ca);

    vec3 swirled = bdVortices(swept, seed, bandCount, vortexStrength);
    vec4 p = vec4(swirled.x * 1.2, swirled.y * 4.5, swirled.z * 1.2, seed);

    // Два масштаба: крупный рвёт пояса, мелкий даёт структуру на кромках
    float coarse = fbm(p, 6, 0.85);
    float fine = fbm(p * BD_FINE_SCALE + 23.0, BD_FINE_OCTAVES, 0.7);
    float noise = coarse + fine * fineDetail;

    // Сила турбулентности своя у каждого пояса: одни спокойные, другие бурлят
    float chaos = 0.4 + 0.6 * (0.5 + 0.5 * fbm(vec4(0.0, lat * 3.0, 0.0, seed + 71.0), 2, 0.5));

    float bands = 0.5 + 0.5 * sin(lat * PI * bandCount + noise * turbulence * chaos);
    float banded = mix(bands, 0.5 + 0.5 * noise, BD_BAND_NOISE_MIX);

    // К полюсам полосы распадаются в изотропную турбулентность — см. bdPolarWeight
    float polar = 1.0 - smoothstep(0.75, 0.95, abs(lat)) * polarChaos;
    float density = mix(0.5 + 0.5 * noise, banded, polar);

    float w = max(fwidth(density) * 1.5, BD_GAP_MIN_WIDTH);
    float relief = mix(BD_DECK_RELIEF_LOW, BD_DECK_RELIEF_HIGH, density);
    float tau = smoothstep(gapThreshold - w, gapThreshold + w, density) * relief;

    // От той же плотности, что и tau, но ДО порога — иначе градиента бы не было
    float depth = bdDepth(density, gapThreshold);

    // Высота несёт мелкую деталь и растянута на весь диапазон: по ней
    // bdShade выбирает цвет палубы, и без растяжки тёмные пояса плоские
    float height = clamp(0.5 + BD_HEIGHT_CONTRAST * (fbm(p * 2.3 + 11.0, 4, 0.7) * 0.6 + fine * 0.4), 0.0, 1.0);

    return vec3(tau, height, depth);
  }

  // Эффективная оптическая толща палубы. mu — косинус (нормаль сферы, луч на
  // камеру): у кромки луч идёт по касательной и набирает больше вещества,
  // поэтому палуба к лимбу темнеет сама.
  //
  // Ловушка: у прогалины tau равен НУЛЮ, и ноль, делённый на mu, остаётся
  // нулём при любом угле — ей потемнение даёт отдельный член в bdShade.
  // Отсечка mu снизу даёт на самом лимбе чистый цвет палубы, а не NaN.
  float bdTauEff(float tau, float mu, float opticalDepth) {
    return tau * opticalDepth / max(mu, 1e-3);
  }

  // Пропускание палубы. Непрерывно и края не имеет — в отличие от порогового
  // smoothstep, который под HDR-контрастом работает усилителем субпиксельного
  // шума.
  float bdTransmit(float tauEff) {
    return exp(-tauEff);
  }

  // Композиция слоёв. Множитель (1 - transmit) у палубы — не подгонка, а закон
  // Кирхгофа: излучательная способность слоя равна единице минус пропускание.
  // tau -> 0 оставляет чистое нутро, tau -> бесконечность — чистую палубу.
  vec3 bdCompose(vec3 cloud, vec3 hot, float transmit) {
    return cloud * (1.0 - transmit) + hot * transmit;
  }

  // Дыхание яркости: сумма синусов, НЕ шум. У суммы синусов нет понятия
  // «сид», результат лежит в [1-amplitude, 1+amplitude] аналитически, а
  // скачок времени даёт сдвиг фазы, а не пересев узора. Трогает только
  // яркость и никогда — форму: время в оптическую толщу не входит.
  float bdBreath(vec3 dir, float t, float amplitude) {
    float s = sin(dot(dir, vec3(0.71, 0.43, 0.55)) * 3.0 + t * 0.11)
            + sin(dot(dir, vec3(-0.36, 0.82, 0.44)) * 5.0 - t * 0.07)
            + sin(dot(dir, vec3(0.52, -0.29, 0.8)) * 8.0 + t * 0.19);

    return 1.0 + amplitude * s / 3.0;
  }

  /** Яркость мелкой прорехи как доля от глубокой: ноль сделал бы её чёрной дырой */
  #define BD_GAP_GLOW_FLOOR 0.45

  #define BD_HDR_CEILING 64.0

  // Полная раскраска фрагмента — ЕДИНСТВЕННАЯ точка композиции на оба LOD.
  // Диск и импостор зовут её одной строкой и разойтись не могут ничем: ни
  // порядком операций, ни забытым дыханием, ни потолком HDR. Собственных
  // bdTransmit/bdCompose в шаблонах быть не должно.
  //
  // field: R — нормированная толща палубы, G — высота верхушки облака,
  // B — глубина видимости в прогалине (bdDepth, считана до порога).
  // Потолок HDR общий со звездой и атмосферой (half-float буфер, AgX-плечо).
  vec3 bdShade(vec3 field, float mu, vec3 dir, vec3 cloud, vec3 cloudHigh, vec3 hot, vec3 hotDeep,
               float opticalDepth, float gapGlow, float limbDarkening, float t, float breathAmplitude) {
    float transmit = bdTransmit(bdTauEff(field.r, mu, opticalDepth));

    // Линейный закон потемнения к краю. Пол 1 − u на самом силуэте: степенной
    // закон обратился бы там в ноль, то есть дал бы чёрную кромку.
    float limb = 1.0 - limbDarkening * (1.0 - mu);

    // Чем глубже видно, тем горячее вещество: у открытой прогалины яркое
    // ядро, гаснущее к краям. Плоский hot давал ровное пятно.
    //
    // Ловушка: с глубиной обязана расти и ЯРКОСТЬ, а не только оттенок. У
    // чёрнотельных цветов красный канал нормирован единицей, поэтому без
    // множителя R равен gapGlow по всей прогалине разом — вся она уходит в
    // плечо кривой тонмаппинга и выцветает в белый, читаясь как шесть тысяч
    // кельвинов вместо двух. С множителем блум ловит только глубокие ядра,
    // а кромки остаются тёмными и насыщенными.
    float glow = gapGlow * mix(BD_GAP_GLOW_FLOOR, 1.0, field.z) * limb;
    vec3 hotLit = mix(hot, hotDeep, field.z) * glow * bdBreath(dir, t, breathAmplitude);

    // Палуба темнеет с высотой верхушки: выше — холоднее и тусклее.
    //
    // Отдельного тонового множителя здесь НЕТ намеренно. Он рос с высотой,
    // тогда как цвет с высотой падал, и они гасили друг друга: перепад по
    // палубе выходил 1.11 раза, то есть тёмные пояса читались ровными.
    vec3 cloudLit = mix(cloud, cloudHigh, field.g);

    return min(bdCompose(cloudLit, hotLit, transmit), vec3(BD_HDR_CEILING));
  }
`
