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
  vec2 bdField(vec3 dir, float seed, float bandCount, float turbulence, float gapThreshold) {
    vec4 p = vec4(dir.x * 1.2, dir.y * 4.5, dir.z * 1.2, seed);
    float noise = fbm(p, 6, 0.85);

    float bands = 0.5 + 0.5 * sin(dir.y * PI * bandCount + noise * turbulence);
    float density = mix(bands, 0.5 + 0.5 * noise, BD_BAND_NOISE_MIX);

    float w = max(fwidth(density) * 1.5, BD_GAP_MIN_WIDTH);
    float tau = smoothstep(gapThreshold - w, gapThreshold + w, density);

    float height = 0.5 + 0.5 * fbm(p * 2.3 + 11.0, 4, 0.7);

    return vec2(tau, height);
  }

  // Эффективная оптическая толща палубы. mu — косинус (нормаль сферы, луч на
  // камеру): у кромки луч идёт по касательной и набирает больше вещества,
  // поэтому прогалины у лимба закрываются сами. Отдельного лимбового
  // потемнения нет — оно выпадает отсюда.
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

  #define BD_CLOUD_TONE_BASE 0.6
  #define BD_CLOUD_TONE_RANGE 0.4
  #define BD_HDR_CEILING 64.0

  // Полная раскраска фрагмента — ЕДИНСТВЕННАЯ точка композиции на оба LOD.
  // Диск и импостор зовут её одной строкой и разойтись не могут ничем: ни
  // порядком операций, ни забытым дыханием, ни потолком HDR. Собственных
  // bdTransmit/bdCompose в шаблонах быть не должно.
  //
  // field: R — нормированная толща палубы, G — высота верхушки облака.
  // Потолок HDR общий со звездой и атмосферой (half-float буфер, AgX-плечо).
  vec3 bdShade(vec2 field, float mu, vec3 dir, vec3 cloud, vec3 hot,
               float opticalDepth, float gapGlow, float t, float breathAmplitude) {
    float transmit = bdTransmit(bdTauEff(field.r, mu, opticalDepth));

    vec3 hotLit = hot * gapGlow * bdBreath(dir, t, breathAmplitude);
    vec3 cloudLit = cloud * (BD_CLOUD_TONE_BASE + BD_CLOUD_TONE_RANGE * field.g);

    return min(bdCompose(cloudLit, hotLit, transmit), vec3(BD_HDR_CEILING));
  }
`
