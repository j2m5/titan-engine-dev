/**
 * AsteroidBrdf — единая модель освещения камней кольца (L0 инстансы, L1 билборды).
 *
 * Диффуз реголита. Ламберт рисует камень «пластиковым шаром»: яркая макушка и
 * плавный спад к терминатору. Реголит на снимках Луны и астероидов почти
 * одинаково ярок по всему диску с резким лимбом — это закон Ломмеля-Зелигера
 * μ0/(μ0 + μ). Смесь по ручке профиля lunarMix, нормирована в лоб (при
 * NdotL = NdotV = 1 обе ветви дают 1), поэтому яркость профиля не плывёт.
 * Оппозиционный пик: при взгляде со стороны звезды (фазовый угол g → 0)
 * реголит вспыхивает, ширина ~6° (exp(−g/0.1)), сила — ручка surge.
 *
 * Planetshine. У камня в кольце есть второй источник — планета рядом, огромная
 * и яркая. Направленный свет от центра планеты (начало ring-local): сила =
 * фаза × телесный угол × N·L с обёрткой. Фаза — доля освещённого полушария,
 * видимая с камня, ½(1 + p̂·L); телесный угол ∝ (R/d)²; обёртка N·L равна
 * угловому радиусу R/d — источник протяжённый. В умбре планеты фаза сама уходит
 * в ноль, отдельный гейт не нужен. Цвет и силу умножает вызывающий; результат
 * ложится на альбедо, не на блик.
 *
 * CPU-зеркало: tests/asteroidSurface/brdfMirror.ts — менять строго синхронно.
 */
export const asteroidBrdfFunctions = `
  // Диффуз реголита: NdotL/NdotV — косинусы к свету и к камере, cosPhase = dot(L, V)
  float asteroidRegolithDiffuse(float NdotL, float NdotV, float cosPhase, float lunarMix, float surge) {
    float nl = max(NdotL, 0.0);
    float nv = max(NdotV, 0.0);
    float lambert = nl;
    float lommel = 2.0 * nl / max(nl + nv, 1e-4);
    float diffuse = mix(lambert, lommel, lunarMix);
    float g = acos(clamp(cosPhase, -1.0, 1.0));
    float opposition = 1.0 + surge * exp(-g / 0.1);
    return diffuse * opposition;
  }

  // Planetshine: N и dirPlanet — в одном пространстве (view), ringPos и
  // lightDirRing — в ring-local (планета в начале координат), planetRadius —
  // в единицах ringPos. Возвращает множитель альбедо
  float asteroidPlanetshine(vec3 N, vec3 dirPlanet, vec3 ringPos, vec3 lightDirRing, float planetRadius) {
    float d = length(ringPos);
    if (planetRadius <= 0.0 || d <= planetRadius) return 0.0;
    vec3 pHat = ringPos / d;
    float phase = 0.5 * (1.0 + dot(pHat, lightDirRing));
    float angR = planetRadius / d;
    float solid = angR * angR;
    float wrap = angR;
    float wrapped = max(dot(N, dirPlanet) + wrap, 0.0) / (1.0 + wrap);
    return phase * solid * wrapped;
  }
`
