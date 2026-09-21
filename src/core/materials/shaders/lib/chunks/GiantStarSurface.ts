/**
 * Формулы поверхности звезды-гиганта, общие для диска и билборда-импостора.
 *
 * Зависимости (потребитель включает ДО этого чанка, в таком порядке):
 * noiseFunctions (snoise(vec4)), starSurface (starGranulationFade,
 * starGranuleColor), planckLimb.
 *
 * Производных здесь нет намеренно: экранный масштаб домена считает вызывающая
 * сторона до ветвления и передаёт аргументом.
 *
 * CPU-зеркало композиции: tests/giantStar/giantStarSurfaceMirror.ts.
 */
export const giantStarSurface = `
  // Предохранитель half-float буфера; гигант до него не достаёт
  #define GS_HDR_CEILING 64.0
  // Полуширина межъячейковой прожилки в единицах низкочастотного шума
  #define GS_LANE_WIDTH 0.12
  // Насколько прожилка остужает ячейку, в долях t
  #define GS_LANE_DEPTH 0.35
  // Частота ряби относительно ячеек и её амплитуда в долях t
  #define GS_RIPPLE_SCALE 6.0
  #define GS_RIPPLE_AMPLITUDE 0.25
  // Порог и усиление горячих пятен
  #define GS_SPOT_THRESHOLD 0.65
  #define GS_SPOT_GAIN 1.5
  // Размах поля ячеек: fbm знаковый, сигма около 0.3
  #define GS_CELL_GAIN 1.4

  float gsFbm3(vec4 pos) {
    return (snoise(pos) + 0.5 * snoise(pos * 2.0) + 0.25 * snoise(pos * 4.0)) / 1.75;
  }

  // «Температура ячейки» t в [0..1]: 0 холодная, 0.5 база, 1 горячая.
  // domain — единичное направление в объектных координатах * cellCount + seed.
  // Низкочастотный шум работает дважды: его нулевые изолинии замкнуты и дают
  // контуры ячеек, а его значение слегка искажает домен.
  // Гасится к 0.5, а не к нулю: пропадает зерно, а не яркость диска.
  float gsCellT(vec3 domain, float time, float fadeCells, float fadeRipple) {
    if (fadeCells <= 0.0) return 0.5;

    float n = snoise(vec4(domain * 0.5 + 31.0, time * 0.5));
    float t = 0.5 + gsFbm3(vec4(domain + 0.35 * n, time)) * GS_CELL_GAIN;

    t -= GS_LANE_DEPTH * (1.0 - smoothstep(0.0, GS_LANE_WIDTH, abs(n)));

    if (fadeRipple > 0.0) {
      t += GS_RIPPLE_AMPLITUDE * fadeRipple * gsFbm3(vec4(domain * GS_RIPPLE_SCALE + 7.0, time * 3.0));
    }

    float spot = max(t - GS_SPOT_THRESHOLD, 0.0);
    t += GS_SPOT_GAIN * spot * spot;

    return mix(0.5, clamp(t, 0.0, 1.0), fadeCells);
  }

  // Яркость ячейки: те же три стопа и тот же t, что у цвета
  float gsEnergy(float t, vec3 energy) {
    return t < 0.5 ? mix(energy.x, energy.y, t * 2.0) : mix(energy.y, energy.z, t * 2.0 - 1.0);
  }

  // exposure умножается ПОСЛЕ потолка: иначе у тела, пробившего потолок,
  // спад экспозиции съедался бы min
  vec3 gsCompose(
    float t, float mu,
    vec3 cool, vec3 base, vec3 hot, vec3 cellEnergy,
    vec3 planckX, float intensity, float exposure
  ) {
    vec3 color = starGranuleColor(t, cool, base, hot);
    float energy = gsEnergy(t, cellEnergy) * intensity;

    return min(color * energy * planckLimb(mu, planckX), vec3(GS_HDR_CEILING)) * exposure;
  }

  // Единственная точка композиции тела: оба LOD зовут её одним списком аргументов.
  // domainPerPixel — starDomainPerPixel(domain), посчитанный ДО ветвления
  vec3 giantStarShade(
    vec3 domain, float domainPerPixel, float time, float mu,
    vec3 cool, vec3 base, vec3 hot, vec3 cellEnergy,
    vec3 planckX, float intensity, float exposure
  ) {
    float fadeCells = starGranulationFade(domainPerPixel);
    float fadeRipple = starGranulationFade(domainPerPixel * GS_RIPPLE_SCALE);
    float t = gsCellT(domain, time, fadeCells, fadeRipple);

    return gsCompose(t, mu, cool, base, hot, cellEnergy, planckX, intensity, exposure);
  }
`
