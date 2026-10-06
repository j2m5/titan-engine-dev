import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, UniformsUtils, Vector2, Vector3 } from 'three'
import { AppUniformsChunk } from './chunks'
import {
  planetSurfaceComposite,
  planetSurfaceDefaultUniforms,
  planetSurfaceDirectGain,
  planetSurfaceDirectLight,
  planetSurfaceFragmentFunctions,
  planetSurfaceFragmentOutput,
  planetSurfaceFragmentPars,
  planetSurfaceFragmentPrologue,
  planetSurfaceLightBegin,
  planetSurfaceRingShadowPars,
  planetSurfaceVaryings,
  planetSurfaceVertexLight,
  planetSurfaceVertexOutputs,
  planetSurfaceVertexPars
} from './chunks/PlanetSurfaceCommon'

const terrainUniforms = {
  // slope-карта: R/G — уклон, B — полость
  bumpMap: new Uniform(null),
  // Множитель декода slope-карты (чанк SlopeNormal)
  bumpScale: new Uniform(0),
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
  // Ближний слой тени рельефа (USE_TERRAIN_SHADOW): вес 0 — плитки нет
  uNearTile: new Uniform(null),
  uNearTileCenter: new Uniform(new Vector3(1, 0, 0)),
  uNearTileEast: new Uniform(new Vector3(0, 0, -1)),
  uNearTileNorth: new Uniform(new Vector3(0, 1, 0)),
  uNearTileTexelMeters: new Uniform(64),
  uNearTileTexels: new Uniform(512),
  uNearTileWeight: new Uniform(0),
  uNearShadowMaxDistMeters: new Uniform(8000),
  uNearCameraXY: new Uniform(new Vector2(0, 0)),
  uNearCameraFadeMeters: new Uniform(new Vector2(6500, 9000)),
  uBodyRadiusMeters: new Uniform(0)
}

/**
 * Поверхность на патчах кубосферы (TerrainSphere): UV попиксельно из
 * направления, slope-карта, деталь, средняя полоса, тени, иней, мокрая кромка.
 * Стриминговые слои по-прежнему гейтятся своими дефайнами.
 */
export const TerrainShaderTemplate: ShaderProps = {
  uniforms: UniformsUtils.merge([planetSurfaceDefaultUniforms, terrainUniforms, AppUniformsChunk.ringShadowUniforms]),
  vertexShader: `
    ${planetSurfaceVertexPars}

    // Атрибуты normal и uv сняты из геометрии патча: направление вершины —
    // из RTC-позиции и центра патча, uv фрагментник считает сам.
    // Инстансный атрибут: один элемент на патч (см. TerrainPatchPool).
    attribute vec3 patchCenter;
    // Геоморф (TerrainPatchGroup): смещение вершины к форме родителя (RTC) и
    // инстансная доля 0..1; без морф-пула их значения — defaultAttributeValues
    // материала (нули), иначе three читает общий generic-слот GL
    attribute vec3 morphDelta;
    attribute float patchMorph;

    #ifdef USE_TERRAIN_DETAIL
      // Домен детальных текстур: тело-локальная позиция минус k·W
      // (detailWrap.ts) = position + смещение патча center − k·W — без
      // квантования float32 единичного направления.
      attribute vec3 detailOrigin;
      attribute vec3 detailOrigin2;
      varying vec3 vDetailPos;
      varying vec3 vDetailPos2;
    #endif

    #if defined(USE_TERRAIN_MACRO_DETAIL) || defined(USE_WATER_EDGE) || defined(USE_TERRAIN_FROST)
      // Высота КАРТЫ в вершине (метры над референсом, без полосы B) — фаза
      // террас, мокрая кромка берега и линия инея
      attribute float height;
      varying float vHeightMeters;
    #endif

    #ifdef USE_TERRAIN_MACRO_DETAIL
      // Геометрия полосы B в вершине: x — высота полосы / maxAmplitude,
      // y — доля октав уровня, взвешенная огибающей (1 — полоса здесь есть вся)
      attribute vec2 midShade;
      varying vec2 vMidShade;
      attribute vec2 midShadeParent;
    #endif

    #ifdef USE_SLOPE
      // Наклон геометрии средней полосы B (tan в базисе T/B SlopeNormal) —
      // домешивается в декод slope-карты во фрагменте
      attribute vec2 midTilt;
      varying vec2 vMidTilt;
      attribute vec2 midTiltParent;
    #endif

    void main() {
      // геоморф: 0 — своя форма, 1 — форма родителя (TerrainPatchGroup)
      float morphT = smoothstep(0.0, 1.0, patchMorph);
      vec3 morphedPosition = position + morphDelta * morphT;

      ${planetSurfaceVertexLight}

      // Радиальное направление вершины в системе тела — из RTC-позиции и центра патча
      vec3 vertexDir = normalize(morphedPosition + patchCenter);

      ${planetSurfaceVertexOutputs}

      #ifdef USE_TERRAIN_DETAIL
        vDetailPos = position + detailOrigin;
        vDetailPos2 = position + detailOrigin2;
      #endif

      #if defined(USE_TERRAIN_MACRO_DETAIL) || defined(USE_WATER_EDGE) || defined(USE_TERRAIN_FROST)
        vHeightMeters = height;
      #endif

      #ifdef USE_TERRAIN_MACRO_DETAIL
        vMidShade = mix(midShade, midShadeParent, morphT);
      #endif

      #ifdef USE_SLOPE
        vMidTilt = mix(midTilt, midTiltParent, morphT);
      #endif

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${planetSurfaceFragmentPars}

    // slope-карта (R/G — уклон, B — полость), множитель декода (чанк SlopeNormal), сила полости
    uniform sampler2D bumpMap;
    uniform float bumpScale;
    uniform float uCavityStrength;

    ${planetSurfaceVaryings}

    #ifdef USE_SLOPE
      // Наклон геометрии средней полосы B — домешивается в декод slope-карты
      varying vec2 vMidTilt;
      #include <slopeNormalUniforms>
      #include <slopeNormalFunctions>
    #endif

    // Развёртка из направления: рельеф и облачный слой
    #include <terrainUvFunctions>

    // Тень рельефа: та же карта высот, читает uBodyRadiusUnits выше
    #ifdef USE_TERRAIN_SHADOW
      #include <terrainShadowMarchUniforms>
      #include <terrainShadowMarchFunctions>
      #include <terrainNearShadowFunctions>
    #endif

    ${planetSurfaceFragmentFunctions}

    #ifdef USE_TERRAIN_DETAIL
      varying vec3 vDetailPos;
      varying vec3 vDetailPos2;
      #include <terrainDetailUniforms>
      #include <triplanarDetailFunctions>
      #include <terrainDetailFunctions>
    #endif

    #if defined(USE_TERRAIN_MACRO_DETAIL) || defined(USE_WATER_EDGE) || defined(USE_TERRAIN_FROST)
      varying float vHeightMeters;
    #endif

    #ifdef USE_WATER_EDGE
      // Мокрая кромка берега: уровень воды тела и ширина/потемнение полосы
      uniform float uWaterLevelMeters;
      uniform float uWetBandMeters;
      uniform float uWetDarken;
      #define WET_GLOSS 0.6
    #endif

    #ifdef USE_TERRAIN_FROST
      // Иней: сила, линия (x — высота, y — ширина, z — понижение к полюсу, w — к полюсу на склоне), предел уклона, цвет
      uniform float uFrostStrength;
      uniform vec4 uFrostLine;
      uniform float uFrostSlopeMax;
      uniform vec3 uFrostColor;
    #endif

    // Средняя полоса детали рельефа: километровый fbm под текселем диффуза
    #ifdef USE_TERRAIN_MACRO_DETAIL
      // Геометрия полосы B в вершине (см. вершинник): x — высота полосы в долях
      // максимальной амплитуды, y — доля октав уровня, взвешенная огибающей
      varying vec2 vMidShade;
      #include <noiseFunctions>
      #include <terrainMacroDetailUniforms>
      #include <terrainMacroDetailFunctions>
    #endif

    ${planetSurfaceRingShadowPars}

    // Блинн-Фонг + френель Шлика (F0 воды 0.02): блеск мокрой кромки берега
    float blinnPhongGlint(vec3 normal, vec3 lightDirection, vec3 viewDir) {
      vec3 halfVec = normalize(lightDirection + viewDir);
      float specComp = pow(max(dot(normal, halfVec), 0.0), 64.0);
      float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
      return specComp * fresnel;
    }

    #ifdef USE_TERRAIN_GLINT
      // Блеск льда: нормированный Блинн–Фонг по шероховатости слоя детали, Френель льда
      uniform float uIceGlintStrength;
      #define ICE_GLINT_F0 0.018
      float terrainIceGlint(vec3 normal, vec3 lightDirection, vec3 viewDir, float roughness) {
        float gloss = 1.0 - clamp(roughness, 0.0, 1.0);
        float power = mix(8.0, 512.0, gloss * gloss);
        vec3 halfVec = normalize(lightDirection + viewDir);
        // dot(V, halfVec) может округлиться выше 1 (V≈L, float32) — без верхнего
        // клампа степень 5 получает отрицательное основание, pow даёт NaN (ANGLE/D3D)
        float fresnel = ICE_GLINT_F0 + (1.0 - ICE_GLINT_F0) * pow(1.0 - clamp(dot(viewDir, halfVec), 0.0, 1.0), 5.0);
        // нормировка (p+8)/8π рассчитана на домножение на N·L
        return (power + 8.0) / 25.1327412 * pow(max(dot(normal, halfVec), 0.0), power) * fresnel * gloss * gloss * max(dot(normal, lightDirection), 0.0);
      }
    #endif

    void main() {
      ${planetSurfaceFragmentPrologue}
      float wetEdge = 0.0;
      float glintEdge = 0.0;
      float terrainRoughness = 1.0; // шероховатость слоя детали; дальше слоя — матово

      // UV из направления, попиксельно: вершинная развёртка равнопромежуточной
      // текстуры на кубосфере вырождается у полюсов. Чанк общий с водой —
      // береговая линия совпадает тексель-в-тексель (см. докблок terrainUvFunctions).
      vec3 dirLocal = normalize(vLocalDir);
      vec2 uv = terrainUv(dirLocal);
      vec3 diffuseSample = texture2D(diffuseMap, uv).rgb;
      // Пертурбация нормали — в системе тела; normalMatrix применяется ровно
      // один раз, после всех слоёв (с поворотом коммутирует: она ортогональна
      // с точностью до масштаба, normalize его снимает).
      vec3 nLocal = dirLocal;
      // Восток попиксельно, из точного dirLocal (интерполяция varying'ом
      // закручивала TBN у полюса); длина ∝ cos(широты) — от неё полюсный гард чанков.
      vec3 eastLocal = cross(vec3(0.0, 1.0, 0.0), dirLocal);

      // tan уклона карты для маски зон детали и инея; без slope-карты 0 — steep-зона закрыта
      float terrainSlopeTan = 0.0;
      #ifdef USE_SLOPE
        // perturbNormalFromSlope отдаёт декодированный вектор уклона КАРТЫ
        // (наклон полосы B открывал бы камень вдоль её гребней)
        vec2 terrainMapSlopeVec;
        nLocal = perturbNormalFromSlope(nLocal, eastLocal, uv, vMidTilt, terrainMapSlopeVec);
        terrainSlopeTan = length(terrainMapSlopeVec);
      #endif

      #ifdef USE_CAVITY
        // Полость — канал B slope-карты (scripts/lib/cavityMap.ts): плюс — гребень,
        // минус — яма. Декод без SLOPE_RANGE (контракт канала, slopeMapEncode.ts).
        // Пишется в occlusion (затенение), не в альбедо.
        float cavity = (texture2D(bumpMap, uv).z * 255.0 - 128.0) / 127.0;
        occlusion *= clamp(1.0 + uCavityStrength * cavity, 0.0, 2.0);
      #endif

      #ifdef USE_TERRAIN_MACRO_DETAIL
        // Данные рельефа читает хост: чанк не сэмплит slope-карту. Канал B —
        // только под USE_CAVITY (без гейта карта может быть без полости).
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
        applyTerrainDetail(nLocal, albedoMul, occlusion, vDetailPos, vDetailPos2, length(vViewPosition), terrainSlopeTan, terrainRoughness);
      #endif

      occlusion = clamp(occlusion, 0.0, 2.0); // гребни cavity × AO детали уходят выше 2 — единый потолок перед светом

      // Единственный переход тело-локальной нормали в view-пространство
      normal = normalize(normalMatrix * nLocal);

      ${planetSurfaceLightBegin}

      // Единичное НА солнце в системе тела — общий вход тени облаков и марша тени рельефа
      vec3 sunLocal = -normalize(vLocalLightDirection);
      #ifdef USE_CLOUD_SHADOW
        // тот же закон, что у воды (чанк CloudLayer); muS = dot(dirLocal, sunLocal)
        cloudShadow = cloudShadowAt(dirLocal, sunLocal, muS);
      #endif

      ${planetSurfaceDirectGain}

      #ifdef USE_TERRAIN_SHADOW
        // только прямой свет; при N·L ≤ 0 mix ниже даёт directGain нулевой вес — марш не платится
        if (NdotLraw > 0.0) terrainShadow = mix(1.0, terrainShadowMarch(dirLocal, sunLocal), uTerrainShadowStrength);
        // ближний слой (плитка у камеры): ветка по юниформу однородна, при весе 0 terrainShadow прежний
        if (NdotLraw > 0.0 && uNearTileWeight > 0.0) {
          float nearWeight = terrainNearShadowWeight(dirLocal);
          if (nearWeight > 0.0) terrainShadow = min(terrainShadow, mix(1.0, terrainNearShadowMarch(dirLocal, sunLocal), nearWeight));
        }
        directGain *= terrainShadow;
      #endif

      ${planetSurfaceDirectLight}

      #ifdef USE_TERRAIN_FROST
        // Иней — цвет, не затенение: линия опускается к полюсу и на склонах, обращённых к полюсу
        float frostSinLat = dirLocal.y;
        float frostPole = frostSinLat >= 0.0 ? 1.0 : -1.0;
        float frostFacing = terrainSlopeTan > 1e-6 ? dot(-terrainMapSlopeVec / terrainSlopeTan, vec2(0.0, frostPole)) * smoothstep(0.0, 0.1, terrainSlopeTan) : 0.0;
        float frostLineH = uFrostLine.x - uFrostLine.z * abs(frostSinLat) - uFrostLine.w * max(frostFacing, 0.0);
        float frostMask = uFrostStrength * smoothstep(frostLineH - 0.5 * uFrostLine.y, frostLineH + 0.5 * uFrostLine.y, vHeightMeters)
                        * (1.0 - smoothstep(0.7 * uFrostSlopeMax, uFrostSlopeMax, terrainSlopeTan));
        surfaceAlbedo = mix(surfaceAlbedo, uFrostColor, frostMask);
      #endif

      ${planetSurfaceComposite}

      #ifdef USE_WATER_EDGE
        // Блеск мокрой кромки — тот же глинт без карты, силой WET_GLOSS
        finalColor += glintEdge * blinnPhongGlint(normal, lightDirection, viewDir) * WET_GLOSS
                    * smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor * terrainShadow * eclipse;
      #endif

      #ifdef USE_TERRAIN_GLINT
        // лёд блестит, снег (шероховатость ≈ 1) и дальний план — нет
        finalColor += terrainIceGlint(normal, lightDirection, viewDir, terrainRoughness) * uIceGlintStrength
                    * smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor * terrainShadow * eclipse;
      #endif

      ${planetSurfaceFragmentOutput}
    }
  `
}
