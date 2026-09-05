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

    #ifdef USE_TERRAIN_DETAIL
      // Точная тело-локальная позиция минус k·W (detailWrap.ts): домен
      // детальных текстур без квантования float32 единичного направления.
      attribute vec3 detailPos;
      attribute vec3 detailPos2;
      varying vec3 vDetailPos;
      varying vec3 vDetailPos2;
    #endif

    #ifdef USE_TERRAIN_MACRO_DETAIL
      // Высота вершины (метры над референсом) — фаза террас средней полосы
      attribute float height;
      varying float vHeightMeters;
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

      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      // У патчей кубосферы position — смещение от ЦЕНТРА ПАТЧА (RTC), не от
      // центра тела; USE_RING (RingShadow) сегодня безвредно её использует
      // только для тел без колец-детей — терраформное тело с кольцом даст
      // неверную тень (чинить при первом таком теле).
      vPosition = position;
      // Body-локальное радиальное направление для попиксельного UV терраформных
      // тел (USE_TERRAIN_UV) — без матриц: normal уже радиальна и body-локальна
      // на обоих путях (SphereGeometry и RTC-патчи кубосферы).
      vLocalDir = normal;
      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vLocalLightDirection = localLightDirection;
      vViewPosition = -mvPosition.xyz;

      #ifdef USE_TERRAIN_DETAIL
        vDetailPos = detailPos;
        vDetailPos2 = detailPos2;
      #endif

      #ifdef USE_TERRAIN_MACRO_DETAIL
        vHeightMeters = height;
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

    // Средняя полоса детали рельефа (терраформный путь): километровый fbm
    // под текселем диффуза. Шум — только под этим гейтом (у гигантов свой).
    #ifdef USE_TERRAIN_MACRO_DETAIL
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

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 normal = normalize(vNormal);
      // Множитель альбедо от терраформного детального слоя (задача 4) —
      // применяется на месте выборки dayColor ниже, дальше самого UV-ветвления
      vec3 albedoMul = vec3(1.0);

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
          // out-перегрузка perturbNormalFromSlope (SlopeNormal.ts) отдаёт уже
          // декодированный вектор уклона — ВТОРОЙ выборки той же текстуры
          // под тем же uv здесь больше нет (не macroSlope ниже: тот же
          // формат байта, но отдельный путь под другим гейтом).
          vec2 terrainSlopeVec;
          nLocal = perturbNormalFromSlope(nLocal, eastLocal, uv, vMidTilt, terrainSlopeVec);
          terrainSlopeTan = length(terrainSlopeVec);
        #endif

        #ifdef USE_CAVITY
          // Полость запечена офлайн в канале B slope-карты (DoG-полосы
          // рельефа, scripts/lib/cavityMap.ts): плюс — гребень (светлее),
          // минус — яма (темнее). Декод БЕЗ множителя SLOPE_RANGE — контракт
          // канала B отличается от R/G (см. slopeMapEncode.ts). Светонезависимый
          // контраст рельефа — как AO, но без пересчёта на GPU.
          float cavity = (texture2D(bumpMap, uv).z * 255.0 - 128.0) / 127.0;
          albedoMul *= clamp(1.0 + uCavityStrength * cavity, 0.0, 2.0);
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
          applyTerrainMacroDetail(nLocal, albedoMul, dirLocal, eastLocal, macroSlope, length(macroMapSlope), macroCavity, uv, length(vViewPosition));
        #endif

        #ifdef USE_TERRAIN_DETAIL
          applyTerrainDetail(nLocal, albedoMul, dirLocal, vDetailPos, vDetailPos2, length(vViewPosition), terrainSlopeTan);
        #endif

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
      float lightIntensity = max(NdotLraw, 0.0);

      vec3 dayColor = diffuseSample;
      dayColor *= albedoMul;

      #ifdef USE_TERRAIN_UV
        // Ламберт суши: без него нормаль (slope-карта, детальные трипланары)
        // видна только в полосе терминатора — dayFactor ниже насыщается при
        // N·L > 0.25. Только на dayColor: облака ниже шейдятся своим законом,
        // нормаль рельефа к ним отношения не имеет. При uTerrainLambert = 0
        // множитель ≡ 1 (прежний вид).
        // Пол ∝ солнцу над горизонтом: рассеянный свет — от соседнего
        // освещённого грунта; у терминатора грунт тёмный, пол уходит к нулю,
        // и рельеф там читается контрастно с орбиты. В полдень пол = terrainAmbient.
        float ambientFloor = uTerrainAmbient * clamp(sunElevation / max(uTerrainAmbientSunRef, 1e-3), 0.0, 1.0);
        dayColor *= mix(1.0, mix(ambientFloor, 1.0, max(NdotLraw, 0.0)), uTerrainLambert);
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

      vec3 day = cloudColor + dayColor * (1.0 - cloudAlpha);

      // Цвет солнца сквозь атмосферу (LUT пропускания): палуба и облака у
      // терминатора теплеют и темнеют синхронно с небом; в зените тинт ≡ 1.
      // mu_s — по радиальному направлению сферы, не по нормали рельефа.
      // vLocalLightDirection направлен ОТ солнца к точке (см. вершинник) —
      // знак минус даёт μ_s = +1 в подсолнечной точке.
      #ifdef USE_SUN_TINT
        day *= mix(vec3(1.0), sunTint(dot(normalize(vLocalDir), -normalize(vLocalLightDirection))), uSunTintStrength);
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

      vec3 finalColor = mix(night, day, dayFactor);
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

      #ifdef USE_SPECULAR
        // Blinn-Phong + френель Шлика (F0 воды 0.02): дорожка следит за
        // камерой, вспыхивает на скользящих углах, гаснет у терминатора.
        // HDR-глинт поверх клампа — блумит только солнечная дорожка.
        vec3 viewDir = normalize(vViewPosition);
        vec3 halfVec = normalize(lightDirection + viewDir);
        float specComp = pow(max(dot(normal, halfVec), 0.0), 64.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
        float specularIntensity = texture2D(specularMap, uv).r;
        finalColor += specularIntensity * specComp * fresnel * uSpecularStrength
                    * smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor;
      #endif

      // Потолок глинта: планета целиком остаётся далеко под half-float/AgX.
      // При текущих дефолтах пик ~3.0 — потолок рассчитан на подъём uSpecularStrength.
      gl_FragColor = vec4(min(finalColor, vec3(4.0)), 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
