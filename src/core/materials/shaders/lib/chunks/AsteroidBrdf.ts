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
 * Ту же функцию реголита использует шейдер планеты для безатмосферных тел (PlanetSurfaceCommon, USE_REGOLITH).
 *
 * Planetshine. У камня в кольце есть второй источник — планета рядом, огромная
 * и яркая. Направленный свет от центра планеты (начало ring-local): сила =
 * фаза × телесный угол × N·L с обёрткой. Фаза — доля освещённого полушария,
 * видимая с камня, ½(1 + p̂·L); телесный угол ∝ (R/d)²; обёртка N·L равна
 * угловому радиусу R/d — источник протяжённый. В умбре планеты фаза сама уходит
 * в ноль, отдельный гейт не нужен. Цвет и силу умножает вызывающий; результат
 * ложится на альбедо, не на блик.
 *
 * Подсветка от листа кольца. Камень видит лист кольца (плоскость y = 0 в
 * ring-local): со своей стороны от средней плоскости — солнечную сторону
 * листа, если звезда с той же стороны, иначе — просвет. Однократное
 * рассеяние: солнечная сторона μ0·(1 − e^(−τ/μ0)), просвет τ·e^(−τ/μ0),
 * μ0 — синус высоты звезды над плоскостью; грань получает долю полусферы
 * листа (1 + N·d)/2. Цвет листа, силу и тень планеты умножает вызывающий.
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

  // Подсветка от листа кольца: N и ringNormalView — view, ringPos и lightDirRing —
  // ring-local (лист — плоскость y = 0), tau/sheetColor — по радиусу камня,
  // halfThickness — полутолщина слоя. Возвращает RGB-множитель альбедо
  vec3 asteroidRingshine(vec3 N, vec3 ringNormalView, vec3 ringPos, vec3 lightDirRing, float tau, vec3 sheetColor, float halfThickness) {
    float mu0 = abs(lightDirRing.y);
    if (mu0 < 1e-3 || tau <= 0.0) return vec3(0.0);
    float eps = max(0.05 * halfThickness, 1e-9);
    float lit = mu0 * (1.0 - exp(-tau / mu0));
    float through = tau * exp(-tau / mu0);
    float sunSide = smoothstep(-eps, eps, ringPos.y * sign(lightDirRing.y));
    float sheet = mix(through, lit, sunSide);
    vec3 toSheet = -clamp(ringPos.y / eps, -1.0, 1.0) * ringNormalView;
    float facing = 0.5 * (1.0 + dot(N, toSheet));
    return sheetColor * (sheet * facing);
  }
`
