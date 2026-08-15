/**
 * TerrainDetail — терраформный детальный слой (фрагмент, USE_TERRAIN_DETAIL).
 *
 * Две трипланарные шкалы поверх body-локальной нормали терраформного пути
 * (см. PlanetShaderTemplate — хук сразу после slope-пертурбации, перед
 * единственным normalMatrix). Крупная шкала (период uDetailScale) несёт
 * нормаль + AO + diffuse-модуляцию, мелкая (uDetailScale2) — только нормаль:
 * высокочастотный микрорельеф не даёт выигрыша в читаемости от повторной
 * AO/diffuse-модуляции на этой частоте, только шум.
 *
 * Проекции и whiteout-бленд — переиспользованы из чанка TriplanarDetail
 * (triplanarWeights/triplanarAlbedo/triplanarArm/triplanarNormal), домен —
 * dirLocal (body-локальное направление на единичной сфере). Период задаётся
 * в метрах в данных тела и пересчитывается в юниты на CPU (toThreeJSUnits).
 * Домен — единичный dirLocal без домножения на радиус тела, поэтому
 * фактический период на поверхности ≈ номинал × R_тела в юнитах: у Луны
 * (R ≈ 0.87 юнита) 40 м рендерятся как ~35 м. Для одного тела это съедает
 * ручка detailScaleMeters; при подключении следующего тела либо принять ту
 * же поправку, либо домножать домен на радиус.
 *
 * triplanarNormal/Albedo/Arm читают масштаб из ГЛОБАЛЬНОГО uDetailScale (см.
 * чанк TriplanarDetail — сэмплер первым параметром, масштаб — нет). Для
 * мелкой шкалы домен предварительно домножается на uDetailScale2/uDetailScale,
 * так что внутреннее p*uDetailScale даёт тот же результат, что и p*uDetailScale2
 * напрямую — функции переиспользуются без копирования whiteout-бленда под
 * вторую шкалу (задача 3: чужой бленд не копируем, зовём чужую функцию).
 *
 * uDetailLayerGates (x=AO, y=diffuse, z=мелкая нормаль) — рантайм-множители
 * по факту наличия текстуры (материал), не #ifdef: опциональные слои можно
 * долить без перекомпиляции программы. Базовая крупная нормаль (uDetailNorMap)
 * гейта не имеет — её наличие и есть условие самого USE_TERRAIN_DETAIL
 * (hasHeightField && detailNormalTexture, см. PlanetMaterial).
 *
 * Fade по дистанции — не только косметика: без него трипланар (3 выборки на
 * каждую из четырёх карт) считался бы на каждом пикселе планеты независимо
 * от удаления камеры. Пороги — ручки пер-тела в метрах дистанции камеры
 * (detailFadeMeters/detailFade2Meters, конец fade каждой шкалы; начало —
 * 0.4 × конца, зашито в PlanetShader), CPU переводит их в юниты и кладёт
 * в uDetailFadeRange (vec4: start1, end1, start2, end2). Дефолты 30000/5000 м
 * — дистанция, на которой период соответствующей шкалы (40 м / 7 м) опускается
 * ниже ~1 экранного пикселя (1080p, fov ~50°). uDetailLayerGates —
 * по-слойные uniform-гейты (одинаковы для всех пикселей драв-колла). Ветка
 * `if (max(fade1, fade2) > 0.0)` — другое: viewDistance попиксельна, поэтому
 * дивергентна и она. texture()-выборки внутри дивергентного потока формально
 * UB по производным (dFdx/dFdy), практически безвредно: helper-инвокации на
 * границе всё равно исполняются и дают корректные производные, а вклад на
 * самой кромке умножается на fade → 0.
 */
export const terrainDetailUniforms = `
  uniform sampler2D uDetailDiffMap;
  uniform sampler2D uDetailNorMap;
  uniform sampler2D uDetailArmMap;
  uniform sampler2D uDetailNor2Map;
  uniform float uDetailScale;
  uniform float uDetailScale2;
  uniform float uDetailNormalScale;
  uniform float uDetailSaturation;
  uniform float uDetailBrightness;
  uniform float uDetailAoInfluence;
  uniform vec3 uDetailLayerGates;
  uniform vec4 uDetailFadeRange;
`

export const terrainDetailFunctions = `
  void applyTerrainDetail(inout vec3 nLocal, inout vec3 albedoMul, vec3 dirLocal, float viewDistance) {
    // Пороги фейда — ручки пер-тела в метрах дистанции, сконвертированные
    // в юниты на CPU (см. докстрока чанка и PlanetShader.uDetailFadeRange).
    float fade1 = 1.0 - smoothstep(uDetailFadeRange.x, uDetailFadeRange.y, viewDistance);
    float fade2 = uDetailLayerGates.z * (1.0 - smoothstep(uDetailFadeRange.z, uDetailFadeRange.w, viewDistance));

    if (max(fade1, fade2) > 0.0) {
      vec2 offset = vec2(0.0);
      vec3 w = triplanarWeights(dirLocal);

      if (fade1 > 0.0) {
        vec3 nDetail = triplanarNormal(uDetailNorMap, dirLocal, nLocal, w, offset);
        nLocal = normalize(nLocal + uDetailNormalScale * fade1 * (nDetail - nLocal));

        if (uDetailLayerGates.x > 0.0) {
          float aoDetail = mix(1.0, triplanarArm(uDetailArmMap, dirLocal, w, offset).r, uDetailAoInfluence);
          albedoMul *= mix(1.0, aoDetail, fade1);
        }

        if (uDetailLayerGates.y > 0.0) {
          vec3 diffuseDetail = triplanarAlbedo(uDetailDiffMap, dirLocal, w, offset);
          float lum = dot(diffuseDetail, vec3(0.299, 0.587, 0.114));
          vec3 tint = mix(vec3(lum), diffuseDetail, uDetailSaturation) * uDetailBrightness;
          albedoMul *= mix(vec3(1.0), tint, fade1);
        }
      }

      if (fade2 > 0.0) {
        // Ратио масштабов вместо своего texture2D: triplanarNormal сам умножит
        // p на uDetailScale — предварительное домножение на uDetailScale2/uDetailScale
        // компенсирует разницу и даёт эффективный масштаб uDetailScale2.
        vec3 pSmall = dirLocal * (uDetailScale2 / max(uDetailScale, 1e-6));
        vec3 nDetail2 = triplanarNormal(uDetailNor2Map, pSmall, nLocal, w, offset);
        nLocal = normalize(nLocal + uDetailNormalScale * fade2 * (nDetail2 - nLocal));
      }
    }
  }
`
