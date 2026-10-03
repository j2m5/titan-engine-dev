import { Color, ShaderChunk, Uniform, Vector3 } from 'three'

/**
 * Общие куски шаблонов поверхности планет: сфера (SphereSurfaceShaderTemplate)
 * и патчи рельефа (TerrainShaderTemplate). Вставляются строкой (`${…}`), а не
 * через `#include`: prepareSource раскрывает include на один уровень, а чанки
 * ниже сами подключают чанки. Каждый кусок стоит в обоих шаблонах на одном
 * месте — порядок операторов пути не меняется.
 */

/** Дефолты юниформов, которые читают оба пути. */
export const planetSurfaceDefaultUniforms = {
  lightPosition: new Uniform(new Vector3()),
  uLightColor: new Uniform(new Color(1, 1, 1)),
  diffuseMap: new Uniform(null),
  nightMap: new Uniform(null),
  cloudMap: new Uniform(null),
  emission: new Uniform(1),
  uNightThreshold: new Uniform(0.06),
  uNightSoftness: new Uniform(0.18),
  // Ламберт: 0 — тинт на всём диффузе, без пола
  uTerrainLambert: new Uniform(0),
  // Пол ламберта на обратных к солнцу склонах дневной стороны (под AgX 0.04 читался углём)
  uTerrainAmbient: new Uniform(0.15),
  // N·L (геометрический) полного пола: ниже пол ∝ солнцу над горизонтом, у терминатора → 0
  uTerrainAmbientSunRef: new Uniform(0.3),
  // Высотный fade облачного слоя: 1 — слой виден целиком (см. cloudOpacityForAltitude)
  uCloudOpacity: new Uniform(1),
  // Закон реголита (USE_REGOLITH): доля Ломмеля–Зелигера и всплеск
  uRegolithMix: new Uniform(0),
  uOppositionSurge: new Uniform(0.3)
}

/** Varying'и, общие для вершинника и фрагментника обоих путей. */
export const planetSurfaceVaryings = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vViewLightDirection;
    varying vec3 vLocalLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vLocalDir;
    varying vec3 vLocalViewDir;
`

/** Пролог вершинника: точность, чанки three, позиция звезды, varying'и. */
export const planetSurfaceVertexPars = `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;

    ${planetSurfaceVaryings}
`

/** Вершинник: позиция по morphedPosition и направление на звезду. */
export const planetSurfaceVertexLight = `
      vec4 worldPosition = modelMatrix * vec4(morphedPosition, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(morphedPosition, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      vec3 worldLightDirection = normalize(worldPosition.xyz - lightPosition);
      // modelMatrix — поворот + трансляция (без scale): обратная для
      // направления = транспонированная 3×3, без обращения 4×4 на вершину.
      vec3 localLightDirection = transpose(mat3(modelMatrix)) * worldLightDirection;
      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);
`

/** Вершинник: varying'и из vertexDir (радиальное направление вершины в системе тела). */
export const planetSurfaceVertexOutputs = `
      vNormal = normalize(normalMatrix * vertexDir);
      // У патчей position — смещение от центра патча (RTC), не от центра тела:
      // тень кольца (USE_RING) на патчах неверна
      vPosition = morphedPosition;
      // Тот же вектор — во фрагментник: UV рельефа и облачного слоя считаются из него
      vLocalDir = vertexDir;
      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vLocalLightDirection = localLightDirection;
      // Взгляд в системе тела (облачный слой) — из view-space: mvPosition точен у RTC-патчей,
      // а worldPosition − cameraPosition в float32 теряет километры на больших координатах
      vLocalViewDir = transpose(mat3(modelMatrix)) * (transpose(mat3(viewMatrix)) * mvPosition.xyz);
      vViewPosition = -mvPosition.xyz;
`

/** Пролог фрагментника: общие юниформы (деталь гиганта и varying'и — следом в шаблоне). */
export const planetSurfaceFragmentPars = `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform sampler2D diffuseMap;
    uniform sampler2D nightMap;
    uniform sampler2D cloudMap;
    uniform float uCloudOpacity;
    uniform sampler2D specularMap;
    uniform sampler2D bumpMap;
    uniform float emission;
    uniform float uNightThreshold;
    uniform float uNightSoftness;
    uniform float uCavityStrength;
    uniform float uTerrainLambert;
    uniform float uTerrainAmbient;
    uniform float uTerrainAmbientSunRef;
    // Радиус тела в единицах сцены: длина дуги uv в тени облаков, параллаксе
    // и dip облачного слоя, домен средней полосы — нужен без гейта полосы
    uniform float uBodyRadiusUnits;
    // Доля окклюзии на ПРЯМОМ свете: 0 — AO/полость не гасят солнце (физика),
    // 1 — окклюзия множит и прямой свет
    uniform float uTerrainOcclusionDirect;
    // three не биндит normalMatrix во фрагментник автоматически (только в
    // вершинный пролог) — объявление делает общий юниформ программы видимым.
    uniform mat3 normalMatrix;

    #ifdef USE_LIGHT_TINT
      // Цвет прямого света звезды, linear; амбиент и ночная сторона им не красятся
      uniform vec3 uLightColor;
    #endif

    #ifdef USE_SUN_TINT
      #include <sunTransmittanceUniforms>
    #endif
`

/** Функции фрагментника: тинт солнца, облачный слой, закон реголита. */
export const planetSurfaceFragmentFunctions = `
    #ifdef USE_SUN_TINT
      #include <sunTransmittanceFunctions>
    #endif

    // Облачный слой на высоте h: параллакс, утолщение у края, свет слоя, тень (чанк CloudLayer)
    #ifdef USE_CLOUD
      #include <cloudLayerUniforms>
      #include <cloudLayerFunctions>
    #endif

    // Закон реголита безатмосферных тел (Lommel–Seeliger + оппозиционный всплеск) — функция чанка AsteroidBrdf
    #ifdef USE_REGOLITH
      uniform float uRegolithMix;
      uniform float uOppositionSurge;
      #include <asteroidBrdfFunctions>
    #endif
`

/** Тень кольца. */
export const planetSurfaceRingShadowPars = `
    #ifdef USE_RING
      #include <ringShadowUniforms>
      #include <ringShadowFunctions>
    #endif
`

/** Блинн-Фонг + френель Шлика (F0 воды 0.02): блеск мокрой кромки берега. */
export const planetSurfaceGlintFunctions = `
    float blinnPhongGlint(vec3 normal, vec3 lightDirection, vec3 viewDir) {
      vec3 halfVec = normalize(lightDirection + viewDir);
      float specComp = pow(max(dot(normal, halfVec), 0.0), 64.0);
      float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
      return specComp * fresnel;
    }
`

/** Начало main фрагментника: множители, которые наполняет ветка пути. */
export const planetSurfaceFragmentPrologue = `
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 normal = normalize(vNormal);
      // albedoMul — ЦВЕТ (fbm полосы, тинт детали, мокрое, деталь гигантов)
      // occlusion — ЗАТЕНЕНИЕ (cavity, AO детали, уступы): амбиент целиком, прямой свет ручкой
      vec3 albedoMul = vec3(1.0);
      float occlusion = 1.0;
      float wetEdge = 0.0;
      float glintEdge = 0.0;
      float terrainRoughness = 1.0; // шероховатость слоя детали; дальше слоя — матово
`

/** Свет: направления, тинт солнца, амбиент; кончается заготовкой тени облаков. */
export const planetSurfaceLightBegin = `
      vec3 lightDirection = normalize(vViewLightDirection);
      float NdotLraw = dot(normal, lightDirection);
      // Направление на камеру (view-space) — вход закона реголита и бликов
      vec3 viewDir = normalize(vViewPosition);
      // Угол солнца над геометрическим горизонтом (радиальная нормаль сферы) —
      // терминатор и масштаб пола ламберта; рельеф сюда не входит.
      float sunElevation = dot(normalize(vNormal), lightDirection);
      // Косинус солнца по радиальному направлению тела: общий вход амбиента
      // и тинта солнца. vLocalLightDirection направлен ОТ солнца к точке
      // (см. вершинник) — минус даёт +1 в зените.
      float muS = dot(normalize(vLocalDir), -normalize(vLocalLightDirection));

      // Цвет солнца сквозь атмосферу: прямой свет поверхности и серый пол; облака берут sunTintAt на своей высоте (чанк CloudLayer).
      // Небо из irradiance-LUT пропускание уже несёт — второй раз его не множить
      vec3 sunTintMix = vec3(1.0);
      #ifdef USE_SUN_TINT
        sunTintMix = mix(vec3(1.0), sunTint(muS), uSunTintStrength);
      #endif

      // Собственная тень рельефа; 1 без гейта — блики ниже читают её всегда
      float terrainShadow = 1.0;

      // Освещение общее для обоих путей: сфера (гиганты всегда, твёрдые тела до
      // карты высот) получает тот же ламберт с полом, что рельеф (безатмосферные
      // тела — закон реголита), — на гейте карты высот вид не прыгает. На сфере
      // occlusion ≡ 1, normal — радиальная.
      // Амбиент — свет от неба/соседнего грунта: серый пол ∝ солнцу над геометрическим
      // горизонтом (безвоздушные тела); у тел с атмосферой — цвет и спад из irradiance-LUT
      vec3 skyTerm = vec3(clamp(sunElevation / max(uTerrainAmbientSunRef, 1e-3), 0.0, 1.0)) * sunTintMix;
      #if defined(USE_SKY_AMBIENT) && defined(USE_SUN_TINT)
        // ветка юниформная (без производных внутри): при 0 два тапа LUT не платятся
        if (uSkyAmbientStrength > 0.0) skyTerm = mix(skyTerm, skyAmbientTint(muS), uSkyAmbientStrength);
      #endif
      vec3 ambient = uTerrainAmbient * skyTerm * occlusion;
      // Тень облаков на земле — только прямой свет и только у рельефа (базис east/north)
      float cloudShadow = 1.0;
`

/** Окклюзия на прямом свете — ручкой: 0 — AO не гасит солнце (физика), 1 — множит. */
export const planetSurfaceDirectGain = `
      float directGain = mix(1.0, occlusion, uTerrainOcclusionDirect) * cloudShadow;
`

/** Вес прямого света (ламберт или реголит), свёртка с полом, альбедо поверхности. */
export const planetSurfaceDirectLight = `
      // Вес прямого света: ламберт; у безатмосферных тел — закон реголита
      // (ровный диск в полнолуние, вспышка в противостоянии, нормаль — рельефная)
      float directWeight = max(NdotLraw, 0.0);
      #ifdef USE_REGOLITH
        // μ — по нормали рельефа, но не меньше половины геометрического: грань, отвёрнутая от камеры
        // нормальной картой, иначе прыгала бы к весу 2 (крапинки на серпе, чёрные провалы в тени)
        float regolithMu = max(dot(normal, viewDir), 0.5 * dot(normalize(vNormal), viewDir));
        directWeight = asteroidRegolithDiffuse(NdotLraw, regolithMu, dot(lightDirection, viewDir), uRegolithMix, uOppositionSurge);
      #endif
      // Форма mix(пол, прямой, вес) до веса 1, сверх него — избыток только на прямом свете (см. lit ниже);
      // в полдень при occlusion = 1 и без тени ровно 1; вес — directWeight (ламберт или реголит)
      #ifdef USE_LIGHT_TINT
        vec3 litDirect = vec3(directGain) * uLightColor * sunTintMix;
      #else
        vec3 litDirect = vec3(directGain) * sunTintMix;
      #endif
      // вес до 1 — mix(пол, прямой); избыток реголита сверх 1 добавляет только прямой свет:
      // экстраполяция mix увела бы тень (directGain ≈ 0) ниже пола, в минус
      vec3 lit = mix(ambient, litDirect, min(directWeight, 1.0)) + max(directWeight - 1.0, 0.0) * litDirect;
      vec3 surfaceAlbedo = diffuseSample * albedoMul;
`

/** Сборка: день, ночь, облака, терминатор, тень кольца, кламп блума; кончается заготовкой бликов. */
export const planetSurfaceComposite = `
      // lambert = 0 — тинт на всём диффузе
      vec3 dayColor = surfaceAlbedo * mix(sunTintMix, lit, uTerrainLambert);

      // Ночная и облачная карты есть не у всех тел: без гейта корректность
      // держалась бы на правиле GL «непривязанная текстура читается чёрной».
      vec3 nightColor = vec3(0.0);
      #ifdef USE_NIGHT
        nightColor = texture2D(nightMap, uv).rgb;
      #endif

      // Облачный слой (чанк CloudLayer): точка слоя на луче взгляда, покрытие с утолщением
      // у края, свет в точке слоя — уже с высотным fade; без карты слой нулевой
      vec3 cloudRadiance = vec3(0.0);
      float cloudAlphaSlant = 0.0;
      #ifdef USE_CLOUD
        vec3 cloudPremul;
        vec3 cloudDir;
        cloudLayerSample(normalize(vLocalDir), normalize(vLocalViewDir), cloudPremul, cloudAlphaSlant, cloudDir);
        cloudRadiance = cloudLitRadiance(cloudPremul, cloudDir, -normalize(vLocalLightDirection));
      #endif

      // Огни городов: порог с мягкостью (квадрат душил середину и оставлял
      // ореол вокруг агломераций). Тинт по яркости: тусклые окраины
      // натриево-оранжевые, яркие центры белее. Под клампом 0.99 — огни не блумят.
      float nightLum = dot(nightColor, vec3(0.2126, 0.7152, 0.0722));
      float nightMask = smoothstep(uNightThreshold, uNightThreshold + uNightSoftness, nightLum);
      vec3 nightTint = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.97, 0.92), smoothstep(0.15, 0.6, nightLum));
      vec3 night = nightColor * nightTint * nightMask * emission;

      // Угол солнца для терминатора — по геометрической (радиальной) нормали:
      // рельефная normal уводила бы обратные склоны дневной стороны в «ночь».
      float terminatorNdotL = sunElevation;

      // Терминатор: компактная smoothstep-зона; края — ручки приёмки. Цвет не
      // подкрашивается: покраснение заката — рассеяние в атмосфере (слой Брюнетона).
      float dayFactor = smoothstep(-0.08, 0.25, terminatorNdotL);

      // Ночные огни только в темноте
      float nightGate = 1.0 - smoothstep(-0.05, 0.12, terminatorNdotL);
      night *= nightGate;

      // Поверхность под ламбертом самогасится (пол → 0 за горизонтом). Облака освещает свет
      // слоя (тинт и цвет звезды — внутри cloudRadiance), огни городов гаснут под облаками.
      float landGate = mix(dayFactor, 1.0, uTerrainLambert);
      vec3 day = cloudRadiance + dayColor * (1.0 - cloudAlphaSlant) * landGate;
      vec3 finalColor = night * (1.0 - dayFactor) * (1.0 - cloudAlphaSlant) + day;
      finalColor = clamp(finalColor, 0.0, 1.0);

      // Единый теневой множитель кольца: гасит и диффуз, и блик ниже
      vec3 ringShadowFactor = vec3(1.0);
      #ifdef USE_RING
        ringShadowFactor = getShadowFromRings(vec3(1.0), normalize(vLocalLightDirection));
      #endif
      finalColor *= ringShadowFactor;

      // Bloom-guard владельца: диффуз-композит планеты клампится НИЖЕ порога
      // bloom (0.99 < 1.0) — планета не блумит. Блики добавляются ПОСЛЕ.
      finalColor = clamp(finalColor, 0.0, 0.99);

      #ifdef USE_LIGHT_TINT
        vec3 preGlint = finalColor;
      #endif
`

/** Хвост main: тинт бликов цветом звезды, потолок, тонмап и цветовое пространство. */
export const planetSurfaceFragmentOutput = `
      #ifdef USE_LIGHT_TINT
        // Все блики выше — отражение звезды: красим их разом, диффуз не трогаем
        finalColor = preGlint + (finalColor - preGlint) * uLightColor;
      #endif

      // Потолок глинта: планета целиком остаётся далеко под half-float/AgX.
      // Потолок 4.0 оставляет запас под блики (пик глинта воды ≈ 0.027·uWaterGlintGain;
      // у льда и мокрой кромки свои пики).
      gl_FragColor = vec4(min(finalColor, vec3(4.0)), 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
`
