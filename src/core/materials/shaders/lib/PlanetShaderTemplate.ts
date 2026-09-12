import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, UniformsUtils, Vector3 } from 'three'
import { AppUniformsChunk } from './chunks'

const defaultUniforms = {
  lightPosition: new Uniform(new Vector3()),
  diffuseMap: new Uniform(null),
  nightMap: new Uniform(null),
  cloudMap: new Uniform(null),
  specularMap: new Uniform(null),
  bumpMap: new Uniform(null),
  bumpScale: new Uniform(0),
  emission: new Uniform(1),
  uSpecularStrength: new Uniform(2.0),
  uNightThreshold: new Uniform(0.06),
  uNightSoftness: new Uniform(0.18),
  uDetailDiffMap: new Uniform(null),
  uDetailNorMap: new Uniform(null),
  uDetailArmMap: new Uniform(null),
  uDetailNor2Map: new Uniform(null),
  uDetailScale: new Uniform(0),
  uDetailScale2: new Uniform(0),
  uDetailNormalScale: new Uniform(1),
  uDetailSaturation: new Uniform(0.15),
  uDetailBrightness: new Uniform(1),
  uDetailAoInfluence: new Uniform(0.5),
  uDetailLayerGates: new Uniform(new Vector3(0, 0, 0)),
  uCavityStrength: new Uniform(0),
  // Ламберт суши (спайк) — 0 выключен, дефолт бит-в-бит прежний шейдер.
  uTerrainLambert: new Uniform(0),
  // Пол ламберта суши: обратные к солнцу склоны дневной стороны; под AgX
  // 0.04 читался углём, 0.15 — тёмно-серый с читаемой формой.
  uTerrainAmbient: new Uniform(0.15),
  // Пол ламберта — свет, отражённый от соседнего освещённого грунта: его
  // столько, сколько солнца над горизонтом. Полный пол при геометрическом
  // N·L ≥ 0.3 (~17°), у терминатора → 0 — рельеф с орбиты остаётся контрастным.
  uTerrainAmbientSunRef: new Uniform(0.3),
  // Высотный fade облачного слоя (приёмочная волна 4, №3, идея владельца) —
  // 1 из космоса, гаснет к середине толщины атмосферы (см. докблок
  // cloudOpacityForAltitude в PlanetMaterial.ts). Дефолт 1 — до первого
  // updateCloudOpacity (или у тела без атмосферы, где юниформ так и
  // остаётся 1 навсегда) слой виден целиком, как раньше.
  uCloudOpacity: new Uniform(1)
}
const ringShadowUniforms = AppUniformsChunk.ringShadowUniforms

export const PlanetShaderTemplate: ShaderProps = {
  uniforms: UniformsUtils.merge([defaultUniforms, ringShadowUniforms]),
  vertexShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vViewLightDirection;
    varying vec3 vLocalLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vLocalDir;

    #ifdef USE_TERRAIN_UV
      // Патчи кубосферы: атрибуты normal (= радиальное направление) и uv
      // (мёртв для рендера — фрагментник считает uv сам) сняты из геометрии,
      // направление вершины восстанавливается из RTC-позиции и центра патча.
      // Инстансный атрибут: один элемент на патч (см. TerrainPatchPool).
      attribute vec3 patchCenter;
    #endif

    #ifdef USE_TERRAIN_DETAIL
      // Точная тело-локальная позиция минус k·W (detailWrap.ts): домен
      // детальных текстур без квантования float32 единичного направления.
      attribute vec3 detailPos;
      attribute vec3 detailPos2;
      varying vec3 vDetailPos;
      varying vec3 vDetailPos2;
    #endif

    #if defined(USE_TERRAIN_MACRO_DETAIL) || defined(USE_WATER_EDGE)
      // Высота КАРТЫ в вершине (метры над референсом, без полосы B) — фаза
      // террас и мокрая кромка берега
      attribute float height;
      varying float vHeightMeters;
    #endif

    #ifdef USE_TERRAIN_MACRO_DETAIL
      // Геометрия полосы B в вершине: x — высота полосы / maxAmplitude,
      // y — доля октав уровня, взвешенная огибающей (1 — полоса здесь есть вся)
      attribute vec2 midShade;
      varying vec2 vMidShade;
    #endif

    #ifdef USE_SLOPE
      // Наклон геометрии средней полосы B (tan в базисе T/B SlopeNormal) —
      // атрибут TerrainSphere, домешивается в декод slope-карты во фрагменте
      attribute vec2 midTilt;
      varying vec2 vMidTilt;
    #endif

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      vec3 worldLightDirection = normalize(worldPosition.xyz - lightPosition);
      // modelMatrix — поворот + трансляция (без scale): обратная для
      // направления = транспонированная 3×3, без обращения 4×4 на вершину.
      vec3 localLightDirection = transpose(mat3(modelMatrix)) * worldLightDirection;
      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);

      // Body-локальное радиальное направление вершины: у патчей кубосферы —
      // из RTC-позиции и центра патча, у легаси-сферы (SphereGeometry) —
      // готовый атрибут normal. vUv жив только на легаси-пути: у патчей
      // атрибута uv нет, а терраформный фрагментник считает uv сам.
      #ifdef USE_TERRAIN_UV
        vec3 vertexDir = normalize(position + patchCenter);
      #else
        vec3 vertexDir = normal;
        vUv = uv;
      #endif

      vNormal = normalize(normalMatrix * vertexDir);
      // У патчей кубосферы position — смещение от ЦЕНТРА ПАТЧА (RTC), не от
      // центра тела; USE_RING (RingShadow) сегодня безвредно её использует
      // только для тел без колец-детей — терраформное тело с кольцом даст
      // неверную тень (чинить при первом таком теле).
      vPosition = position;
      // Тот же вектор — во фрагментник: попиксельный UV терраформных тел
      // (USE_TERRAIN_UV) считается из него без матриц.
      vLocalDir = vertexDir;
      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vLocalLightDirection = localLightDirection;
      vViewPosition = -mvPosition.xyz;

      #ifdef USE_TERRAIN_DETAIL
        vDetailPos = detailPos;
        vDetailPos2 = detailPos2;
      #endif

      #if defined(USE_TERRAIN_MACRO_DETAIL) || defined(USE_WATER_EDGE)
        vHeightMeters = height;
      #endif

      #ifdef USE_TERRAIN_MACRO_DETAIL
        vMidShade = midShade;
      #endif

      #ifdef USE_SLOPE
        vMidTilt = midTilt;
      #endif

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 lightPosition;
    uniform sampler2D diffuseMap;
    uniform sampler2D nightMap;
    uniform sampler2D cloudMap;
    uniform float uCloudOpacity;
    uniform sampler2D specularMap;
    uniform sampler2D bumpMap;
    uniform float bumpScale;
    uniform float emission;
    uniform float uSpecularStrength;
    uniform float uNightThreshold;
    uniform float uNightSoftness;
    uniform float uCavityStrength;
    uniform float uTerrainLambert;
    uniform float uTerrainAmbient;
    uniform float uTerrainAmbientSunRef;
    // Радиус тела в единицах сцены: домен средней полосы детали И длина дуги uv
    // в тени облаков — обоим нужен БЕЗ гейта USE_TERRAIN_MACRO_DETAIL (тень
    // облаков работает и при macroStrength 0), поэтому объявление живёт здесь,
    // а не в чанке terrainMacroDetailUniforms.
    uniform float uBodyRadiusUnits;
    // Доля окклюзии на ПРЯМОМ свете: 0 — AO/полость не гасят солнце (физика),
    // 1 — прежний вид (окклюзия множила и прямой свет вместе с цветом)
    uniform float uTerrainOcclusionDirect;
    // Тень облаков на земле (читает блок USE_CLOUD_SHADOW ниже)
    uniform float uCloudShadowStrength;
    uniform float uCloudShadowHeightUnits;
    // three не биндит normalMatrix во фрагментник автоматически (только в
    // вершинный пролог) — юниформ общий на программу, объявление здесь просто
    // делает его видимым этому шейдеру.
    uniform mat3 normalMatrix;

    #ifdef USE_SUN_TINT
      #include <sunTransmittanceUniforms>
    #endif

    #ifdef USE_GIANT_DETAIL
      #include <giantDetailUniforms>
    #endif

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vViewLightDirection;
    varying vec3 vLocalLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vLocalDir;

    #ifdef USE_SLOPE
      // Наклон геометрии средней полосы B — домешивается в декод slope-карты
      varying vec2 vMidTilt;
      #include <slopeNormalUniforms>
      #include <slopeNormalFunctions>
    #endif

    #ifdef USE_TERRAIN_UV
      #include <terrainUvFunctions>
    #endif

    // Тень рельефа: гейт вложен в USE_TERRAIN_UV (та же карта высот), читает uBodyRadiusUnits выше
    #ifdef USE_TERRAIN_SHADOW
      #include <terrainShadowMarchUniforms>
      #include <terrainShadowMarchFunctions>
    #endif

    #ifdef USE_SUN_TINT
      #include <sunTransmittanceFunctions>
    #endif

    #ifdef USE_TERRAIN_DETAIL
      varying vec3 vDetailPos;
      varying vec3 vDetailPos2;
      #include <terrainDetailUniforms>
      #include <triplanarDetailFunctions>
      #include <terrainDetailFunctions>
    #endif

    #if defined(USE_TERRAIN_MACRO_DETAIL) || defined(USE_WATER_EDGE)
      varying float vHeightMeters;
    #endif

    #ifdef USE_WATER_EDGE
      // Мокрая кромка берега: уровень воды тела и ширина/потемнение полосы
      uniform float uWaterLevelMeters;
      uniform float uWetBandMeters;
      uniform float uWetDarken;
      #define WET_GLOSS 0.6
    #endif

    // Средняя полоса детали рельефа (терраформный путь): километровый fbm
    // под текселем диффуза. Шум — только под этим гейтом (у гигантов свой).
    #ifdef USE_TERRAIN_MACRO_DETAIL
      // Геометрия полосы B в вершине (см. вершинник): x — высота полосы в долях
      // максимальной амплитуды, y — доля октав уровня, взвешенная огибающей
      varying vec2 vMidShade;
      #include <noiseFunctions>
      #include <terrainMacroDetailUniforms>
      #include <terrainMacroDetailFunctions>
    #endif

    #ifdef USE_RING
      #include <ringShadowUniforms>
      #include <ringShadowFunctions>
    #endif

    // Деталь облаков гиганта (легаси-ветка): чанку нужен snoise(vec3) — шум
    // включается ТОЛЬКО под этим гейтом, безгейтового noiseFunctions в шаблоне нет.
    #ifdef USE_GIANT_DETAIL
      #include <noiseFunctions>
      #include <giantDetailFunctions>
    #endif

    // Блинн-Фонг + френель Шлика (F0 воды 0.02): солнечная дорожка воды и
    // блеск мокрой кромки берега считаются одним телом
    float blinnPhongGlint(vec3 normal, vec3 lightDirection, vec3 viewDir) {
      vec3 halfVec = normalize(lightDirection + viewDir);
      float specComp = pow(max(dot(normal, halfVec), 0.0), 64.0);
      float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
      return specComp * fresnel;
    }

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 normal = normalize(vNormal);
      // albedoMul — ЦВЕТ (fbm полосы, тинт детали, мокрое, деталь гигантов)
      // occlusion — ЗАТЕНЕНИЕ (cavity, AO детали, уступы): амбиент целиком, прямой свет ручкой
      vec3 albedoMul = vec3(1.0);
      float occlusion = 1.0;
      float wetEdge = 0.0;
      float glintEdge = 0.0;

      #ifdef USE_TERRAIN_UV
        // UV из направления, попиксельно (общий чанк terrainUvFunctions —
        // WaterShaderTemplate сэмплирует канал A той же slope-карты по тому
        // же uv, береговая линия обязана совпасть тексель-в-тексель с этим
        // же расчётом, см. докблок чанка): вершинная развёртка равнопрямо-
        // угольной текстуры на кубосфере вырождается у полюсов (один квад
        // тянул 2048 текселей). RepeatWrapping корректно оборачивает и
        // отрицательный домен u2 ∈ [-0.5, 0.5).
        vec3 dirLocal = normalize(vLocalDir);
        vec2 uv = terrainUv(dirLocal);
        // Единственная выборка диффуза ветки (дальше идёт в dayColor) — как и
        // uv, объявляется по одной на ветку препроцессора.
        vec3 diffuseSample = texture2D(diffuseMap, uv).rgb;
        // Тело-локальный конвейер нормалей: вся пертурбация (slope, следом
        // детальный слой задачи 4) работает в системе координат ТЕЛА, а не
        // вида — normalMatrix применяется РОВНО ОДИН раз, после всех слоёв.
        // Порядок «пертурбация → поворот» даёт тот же вектор, что старый
        // «поворот → пертурбация повёрнутыми базисами»: normalMatrix
        // ортонормальна с точностью до масштаба, а normalize после неё этот
        // масштаб убирает — коммутирует с cross/вычитанием базисов.
        vec3 nLocal = dirLocal;
        // Восток попиксельно, без матриц: интерполяция востока varying'ом
        // (вымерший легаси-путь) врала у полюса — азимут между
        // соседними вершинами полярного квада ~десятки градусов, и TBN
        // закручивался вертушкой. cross с точным dirLocal свободен от этого;
        // длина ∝ cos(широты) — полюсный гард чанков (len < 1e-4) работает
        // от той же длины.
        vec3 eastLocal = cross(vec3(0.0, 1.0, 0.0), dirLocal);

        // tan уклона для маски зон материала (TerrainDetail.applyTerrainDetail,
        // задача 2) — объявлен ДО ветки, чтобы имя было в скоупе вызова ниже
        // независимо от USE_SLOPE. Без slope-карты 0 — steep-зона закрыта
        // (mask смотрит только на slopeTan, см. докстроку чанка).
        float terrainSlopeTan = 0.0;
        #ifdef USE_SLOPE
          // out-параметр perturbNormalFromSlope (SlopeNormal.ts) отдаёт уже
          // декодированный вектор уклона — ВТОРОЙ выборки той же текстуры
          // под тем же uv здесь больше нет (не macroSlope ниже: тот же
          // формат байта, но отдельный путь под другим гейтом). tan уклона
          // КАРТЫ для маски зон (наклон полосы B открывал бы камень вдоль
          // её гребней).
          vec2 terrainMapSlopeVec;
          nLocal = perturbNormalFromSlope(nLocal, eastLocal, uv, vMidTilt, terrainMapSlopeVec);
          terrainSlopeTan = length(terrainMapSlopeVec);
        #endif

        #ifdef USE_CAVITY
          // Полость запечена офлайн в канале B slope-карты (DoG-полосы
          // рельефа, scripts/lib/cavityMap.ts): плюс — гребень (светлее),
          // минус — яма (темнее). Декод БЕЗ множителя SLOPE_RANGE — контракт
          // канала B отличается от R/G (см. slopeMapEncode.ts). Светонезависимый
          // контраст рельефа — как AO, но без пересчёта на GPU: пишется в
          // occlusion (геометрическое затенение), не в альбедо.
          float cavity = (texture2D(bumpMap, uv).z * 255.0 - 128.0) / 127.0;
          occlusion *= clamp(1.0 + uCavityStrength * cavity, 0.0, 2.0);
        #endif

        #ifdef USE_TERRAIN_MACRO_DETAIL
          // Данные рельефа читает хост: чанк не сэмплит slope-карту, декод
          // живёт рядом с декодом cavity выше. Канал B — только под USE_CAVITY
          // (без гейта карта может быть без полости).
          vec4 macroSlopeSample = texture2D(bumpMap, uv);
          // Гейт форм склона — по уклону КАРТЫ: с наклоном полосы B он
          // открывался бы на холмистых равнинах (террасы как горизонтали)
          vec2 macroMapSlope = (macroSlopeSample.xy * 255.0 - 128.0) * (uSlopeRange / 127.0);
          vec2 macroSlope = macroMapSlope + vMidTilt;
          float macroCavity = 0.0;
          #ifdef USE_CAVITY
            macroCavity = (macroSlopeSample.z * 255.0 - 128.0) / 127.0;
          #endif
          applyTerrainMacroDetail(nLocal, albedoMul, occlusion, dirLocal, eastLocal, macroSlope, length(macroMapSlope), macroCavity, uv, length(vViewPosition));
        #endif

        #ifdef USE_WATER_EDGE
          // Мокрая кромка: полоса над уровнем воды темнеет (ниже уреза — дно под
          // мелкой водой, тоже мокрое); гейт по дистанции — тот же fade полосы
          float hAbove = vHeightMeters - uWaterLevelMeters;
          wetEdge = (1.0 - smoothstep(0.0, uWetBandMeters, hAbove)) * (1.0 - smoothstep(uMacroFadeRange.x, uMacroFadeRange.y, length(vViewPosition)));
          albedoMul *= 1.0 - uWetDarken * wetEdge;
          // глинт только в полосе ±W у уреза: глубже блик суши под водой давал бы второй белый блик
          glintEdge = wetEdge * smoothstep(-uWetBandMeters, 0.0, hAbove);
        #endif

        #ifdef USE_TERRAIN_DETAIL
          applyTerrainDetail(nLocal, albedoMul, occlusion, vDetailPos, vDetailPos2, length(vViewPosition), terrainSlopeTan);
        #endif

        occlusion = clamp(occlusion, 0.0, 2.0); // гребни cavity × AO детали уходят выше 2 — единый потолок перед светом

        // Единственный переход тело-локальной нормали в view-пространство —
        // применяется уже ПОСЛЕ детального слоя (нормаль слоя тоже body-локальна)
        normal = normalize(normalMatrix * nLocal);
      #else
        vec2 uv = vUv;

        vec3 diffuseSample = texture2D(diffuseMap, uv).rgb;

        #ifdef USE_GIANT_DETAIL
          // Деталь облаков гиганта под текселем — множитель альбедо, как cavity/детальный слой суши
          applyGiantDetail(albedoMul, normalize(vPosition), uv, dot(diffuseSample, vec3(0.2126, 0.7152, 0.0722)), length(vViewPosition));
        #endif
      #endif

      vec3 lightDirection = normalize(vViewLightDirection);
      float NdotLraw = dot(normal, lightDirection);
      // Угол солнца над геометрическим горизонтом (радиальная нормаль сферы) —
      // терминатор суши и масштаб пола ламберта; рельеф сюда не входит.
      float sunElevation = dot(normalize(vNormal), lightDirection);
      // Косинус солнца по радиальному направлению тела: общий вход амбиента
      // суши (ниже) и тинта солнца (в самом конце). vLocalLightDirection
      // направлен ОТ солнца к точке (см. вершинник) — минус даёт +1 в зените.
      float muS = dot(normalize(vLocalDir), -normalize(vLocalLightDirection));

      // Легаси-значение (гиганты): окклюзия там никем не трогается и ≡ 1 —
      // состав бит-в-бит прежний. Терраформная ветка перезаписывает dayColor.
      vec3 dayColor = diffuseSample * albedoMul * occlusion;

      // Собственная тень рельефа; 1 без гейта — блики ниже читают её всегда
      float terrainShadow = 1.0;

      #ifdef USE_TERRAIN_UV
        // Ламберт суши: без него нормаль (slope-карта, детальные трипланары)
        // видна только в полосе терминатора — dayFactor ниже насыщается при
        // N·L > 0.25. Только на dayColor: облака ниже шейдятся своим законом,
        // нормаль рельефа к ним отношения не имеет. При uTerrainLambert = 0
        // множитель ≡ 1 (прежний вид).
        // Амбиент — свет от неба/соседнего грунта: серый пол ∝ солнцу над геометрическим
        // горизонтом (безвоздушные тела); у тел с атмосферой — цвет и спад из irradiance-LUT
        vec3 skyTerm = vec3(clamp(sunElevation / max(uTerrainAmbientSunRef, 1e-3), 0.0, 1.0));
        #if defined(USE_SKY_AMBIENT) && defined(USE_SUN_TINT)
          // ветка юниформная (без производных внутри): при 0 два тапа LUT не платятся
          if (uSkyAmbientStrength > 0.0) skyTerm = mix(skyTerm, skyAmbientTint(muS), uSkyAmbientStrength);
        #endif
        vec3 ambient = uTerrainAmbient * skyTerm * occlusion;
        // Единичное НА солнце в системе тела — общий вход тени облаков и марша тени рельефа
        vec3 sunLocal = -normalize(vLocalLightDirection);
        // Тень облаков на земле — только прямой свет
        float cloudShadow = 1.0;
        #ifdef USE_CLOUD_SHADOW
          #define CLOUD_SHADOW_MIN_COS 0.15
          // облако, затеняющее точку, стоит по направлению к солнцу на h·tan θ (θ — зенитный угол)
          vec3 sunTangent = sunLocal - dirLocal * muS; // muS = dot(sunLocal, dirLocal), см. выше
          float cosZ = max(muS, CLOUD_SHADOW_MIN_COS);
          vec3 offsetUnits = sunTangent / cosZ * uCloudShadowHeightUnits;
          // eastLocal = cross(up, dir): длина = cos φ; north = cross(dir, east)
          float cosLat = max(length(eastLocal), 1e-3);
          vec3 eastUnit = eastLocal / cosLat;
          vec3 northUnit = normalize(cross(dirLocal, eastUnit));
          vec2 uvShadow = uv + vec2(dot(offsetUnits, eastUnit) / (6.2831853 * uBodyRadiusUnits * cosLat),
                                    dot(offsetUnits, northUnit) / (3.1415927 * uBodyRadiusUnits));
          vec3 cloudAtShadow = texture2D(cloudMap, uvShadow).rgb;
          // × uCloudOpacity: тень гаснет с высотой камеры вместе с самим слоем (высотный fade облаков) — не баг
          float alphaShadow = pow(dot(cloudAtShadow, vec3(1.0)) / 3.0, 0.5) * uCloudOpacity;
          // ровно в полюсе eastLocal = 0 → базис вырожден: тень гасится, NaN не рождается
          cloudShadow = 1.0 - uCloudShadowStrength * alphaShadow * smoothstep(0.0, 0.2, muS) * step(1e-4, length(eastLocal));
        #endif
        // Окклюзия на прямом свете — ручкой: 0 — AO не гасит солнце (физика), 1 — прежний вид
        float directGain = mix(1.0, occlusion, uTerrainOcclusionDirect) * cloudShadow;
        #ifdef USE_TERRAIN_SHADOW
          // только прямой свет; при N·L ≤ 0 mix ниже даёт directGain нулевой вес — марш не платится
          if (NdotLraw > 0.0) terrainShadow = mix(1.0, terrainShadowMarch(dirLocal, sunLocal), uTerrainShadowStrength);
          directGain *= terrainShadow;
        #endif
        // Та же форма mix(пол, 1, N·L), что прежде: в полдень при occlusion = 1 и без тени ровно 1
        vec3 lit = mix(ambient, vec3(directGain), max(NdotLraw, 0.0));
        dayColor = diffuseSample * albedoMul * mix(vec3(1.0), lit, uTerrainLambert);
      #endif

      // Ночная и облачная карты есть не у всех тел. Раньше сэмплеры читались
      // безусловно, и корректность держалась на правиле GL «непривязанная
      // текстура читается чёрной». Гейты делают это явным.
      vec3 nightColor = vec3(0.0);
      #ifdef USE_NIGHT
        nightColor = texture2D(nightMap, uv).rgb;
      #endif

      vec3 cloudColor = vec3(0.0);
      float cloudAlpha = 0.0;
      #ifdef USE_CLOUD
        cloudColor = texture2D(cloudMap, uv).rgb;
        // Покрытие — свойство текстуры, не освещения: считается до шейдинга,
        // иначе облака истончались к терминатору вместе с яркостью.
        cloudAlpha = pow(dot(cloudColor, vec3(1.0)) / 3.0, 0.5);
        // Слой лежит на высоте: шейдится геометрической нормалью сферы, а не
        // нормалью рельефа (slope + детали) — склоны гор к облакам отношения
        // не имеют.
        float cloudLight = max(dot(normalize(vNormal), lightDirection), 0.0);
        cloudColor *= pow(max(0.5 * cloudLight + 0.1, 0.0), 0.5);
        // Высотный fade (приёмочная волна 4, №3) — 1 из космоса, гаснет к
        // середине толщины атмосферы (CPU-считанный юниформ, см.
        // PlanetMaterial.updateCloudOpacity/cloudOpacityForAltitude).
        cloudColor *= uCloudOpacity;
        cloudAlpha *= uCloudOpacity;
      #endif

      // Огни городов: порог с мягкостью вместо квадрата. Квадрат душил
      // середину и оставлял размытый ореол вокруг агломераций; порог гасит
      // слабую засветку и сохраняет яркие ядра. Тинт по яркости: тусклые
      // окраины натриево-оранжевые, яркие центры белее. Всё под клампом 0.99 —
      // огни не блумят.
      float nightLum = dot(nightColor, vec3(0.2126, 0.7152, 0.0722));
      float nightMask = smoothstep(uNightThreshold, uNightThreshold + uNightSoftness, nightLum);
      vec3 nightTint = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.97, 0.92), smoothstep(0.15, 0.6, nightLum));
      vec3 night = nightColor * nightTint * nightMask * emission;

      // Угол солнца для терминатора. У суши — по геометрической (радиальной)
      // нормали сферы, как у облаков: рельефная normal здесь уводила обратные
      // склоны дневной стороны в ветку «ночь» (ровно 0, пол ламберта не
      // доезжал). Форма рельефа — только в ламберте выше (NdotLraw).
      float terminatorNdotL = NdotLraw;
      #ifdef USE_TERRAIN_UV
        terminatorNdotL = sunElevation;
      #endif

      // Терминатор: компактная smoothstep-зона вместо линейного mix по всей
      // полусфере; края зоны — ручки приёмки. Цвет НЕ подкрашивается:
      // покраснение заката — атрибут рассеяния в атмосфере (слой Брюнетона),
      // на поверхности и у безатмосферных тел оно нефизично.
      float dayFactor = smoothstep(-0.08, 0.25, terminatorNdotL);

      // Ночные огни только в темноте (раньше просвечивали на дневной стороне)
      float nightGate = 1.0 - smoothstep(-0.05, 0.12, terminatorNdotL);
      night *= nightGate;

      #ifdef USE_TERRAIN_UV
        // Суша под ламбертом самогасится (пол → 0 за горизонтом, освещённые вершины за
        // терминатором остаются освещёнными); dayFactor гейтит облака и ночь
        float landGate = mix(dayFactor, 1.0, uTerrainLambert);
        vec3 day = cloudColor * dayFactor + dayColor * (1.0 - cloudAlpha) * landGate;
        // Цвет солнца сквозь атмосферу (LUT пропускания): палуба и облака у
        // терминатора теплеют и темнеют синхронно с небом; в зените тинт ≡ 1.
        // muS — по радиальному направлению сферы, не по нормали рельефа (см. выше).
        #ifdef USE_SUN_TINT
          day *= mix(vec3(1.0), sunTint(muS), uSunTintStrength);
        #endif
        vec3 finalColor = night * (1.0 - dayFactor) + day;
      #else
        vec3 day = cloudColor + dayColor * (1.0 - cloudAlpha);
        #ifdef USE_SUN_TINT
          day *= mix(vec3(1.0), sunTint(muS), uSunTintStrength);
        #endif
        vec3 finalColor = mix(night, day, dayFactor);
      #endif
      finalColor = clamp(finalColor, 0.0, 1.0);

      // Единый теневой множитель кольца: гасит и диффуз, и блик ниже
      vec3 ringShadowFactor = vec3(1.0);
      #ifdef USE_RING
        ringShadowFactor = getShadowFromRings(vec3(1.0), normalize(vLocalLightDirection));
      #endif
      finalColor *= ringShadowFactor;

      // Bloom-guard владельца: диффуз-композит планеты клампится НИЖЕ порога
      // bloom (0.99 < 1.0) — планета не блумит. Блик добавляется ПОСЛЕ.
      finalColor = clamp(finalColor, 0.0, 0.99);

      vec3 viewDir = normalize(vViewPosition);
      #ifdef USE_SPECULAR
        // Дорожка следит за камерой, вспыхивает на скользящих углах, гаснет у
        // терминатора. HDR-глинт поверх клампа — блумит только солнечная дорожка.
        float specularIntensity = texture2D(specularMap, uv).r;
        finalColor += specularIntensity * blinnPhongGlint(normal, lightDirection, viewDir) * uSpecularStrength
                    * smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor * terrainShadow;
      #endif

      #ifdef USE_WATER_EDGE
        // Блеск мокрой кромки — тот же глинт без карты, силой WET_GLOSS
        finalColor += glintEdge * blinnPhongGlint(normal, lightDirection, viewDir) * WET_GLOSS
                    * smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor * terrainShadow;
      #endif

      // Потолок глинта: планета целиком остаётся далеко под half-float/AgX.
      // При текущих дефолтах пик ~3.0 — потолок рассчитан на подъём uSpecularStrength.
      gl_FragColor = vec4(min(finalColor, vec3(4.0)), 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
