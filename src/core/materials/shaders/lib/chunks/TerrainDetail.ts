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
 * (triplanarWeights/triplanarBlendRgb/triplanarBlendNormal), домен —
 * dirLocal (body-локальное направление на единичной сфере). Период задаётся
 * в метрах в данных тела и пересчитывается в юниты на CPU (toThreeJSUnits).
 * Домен — единичный dirLocal без домножения на радиус тела, поэтому
 * фактический период на поверхности ≈ номинал × R_тела в юнитах: у Луны
 * (R ≈ 0.87 юнита) 40 м рендерятся как ~35 м. Для одного тела это съедает
 * ручка detailScaleMeters; при подключении следующего тела либо принять ту
 * же поправку, либо домножать домен на радиус.
 *
 * СТОХАСТИЧЕСКИЙ АНТИ-ТАЙЛИНГ (владелец на приёмке увидел повтор 40-метрового
 * тайла на холмах — классическая трипланарная выборка одного периода видна
 * невооружённым глазом). Обе шкалы (крупная и мелкая нормаль) читаются через
 * стохастические обёртки triplanarNormalDetiled/ArmDetiled/AlbedoDetiled
 * (ниже) вместо классических triplanarNormal/Arm/Albedo — техника IQ
 * «texture repetition» (2-тап вариант): на каждую из трёх планарных проекций
 * uv квантуется в целочисленную ячейку (floor), хеш ячейки даёт псевдослучайный
 * сдвиг + знаковый флип одной оси (дешёвая доп. развязка), результат —
 * бленд ДВУХ ближайших ячеек (текущей и диагонального соседа со стороны,
 * куда указывает дробная часть uv) по smoothstep от близости к диагональной
 * границе. Бленд трёх ПРОЕКЦИЙ (triplanarBlendRgb/Normal) не копируется —
 * тот же вызов, что и у классического (недетайленного) астероидного пути,
 * см. TriplanarDetail; отличие только в том, ЧТО подставляется в cx/cy/cz —
 * одна прямая выборка (астероиды) или уже дестохастизированный sampleDetiled
 * (террейн). Хеш — от КВАНТОВАННОЙ (floor) величины uv, не от сырого varying:
 * dirLocal интерполируется по треугольнику, но floor() схлопывает интерполяцию
 * внутри ячейки до целого числа ДО хеша — ULP-джиттер варьинга не усиливается
 * градиентом хеша (см. Noise.ts, hashSurface11 — тот же урок для другого пути).
 * sampleDetiled использует textureGrad-эквивалент (макрос three
 * texture2DGradEXT → textureGrad в GLSL ES 300, см. WebGLProgram) с
 * производными ИСХОДНОГО (нестохастического) uv: обе ячейки сэмплируются с
 * одним и тем же dFdx/dFdy — иначе выбор мипа скачет вместе со стохастическим
 * сдвигом и на границах ячеек виден шов.
 *
 * БЮДЖЕТ (худший случай, обе шкалы + все три канала крупной): было 12 выборок
 * (3 проекции × 4 карты, по одной выборке каждая); стохастика удваивает
 * каждую планарную выборку (2 ближайшие ячейки вместо одной) — 3 проекции ×
 * 2 ячейки × 4 карты (норм. крупная, ARM, diffuse, норм. мелкая) = 24 выборки
 * текстур на пиксель. Fade по дистанции (ниже) — единственная защита от
 * оплаты этого бюджета там, где деталь всё равно не читается.
 *
 * triplanarNormalDetiled/ArmDetiled/AlbedoDetiled читают масштаб из
 * ГЛОБАЛЬНОГО uDetailScale (см. чанк TriplanarDetail — сэмплер первым
 * параметром, масштаб — нет). Для мелкой шкалы домен предварительно
 * домножается на uDetailScale2/uDetailScale, так что внутреннее p*uDetailScale
 * даёт тот же результат, что и p*uDetailScale2 напрямую — функции
 * переиспользуются без копирования бленда под вторую шкалу (задача 3:
 * чужой бленд не копируем, зовём чужую функцию).
 *
 * uDetailLayerGates (x=AO, y=diffuse, z=мелкая нормаль) — рантайм-множители
 * по факту наличия текстуры (материал), не #ifdef: опциональные слои можно
 * долить без перекомпиляции программы. Базовая крупная нормаль (uDetailNorMap)
 * гейта не имеет — её наличие и есть условие самого USE_TERRAIN_DETAIL
 * (hasHeightField && detailNormalTexture, см. PlanetMaterial).
 *
 * Fade по дистанции — не только косметика: без него трипланар (см. БЮДЖЕТ
 * выше) считался бы на каждом пикселе планеты независимо от удаления камеры.
 * Пороги — ручки пер-тела в метрах дистанции камеры (detailFadeMeters/
 * detailFade2Meters, конец fade каждой шкалы; начало — 0.4 × конца, зашито
 * в PlanetShader), CPU переводит их в юниты и кладёт в uDetailFadeRange
 * (vec4: start1, end1, start2, end2). Дефолты 30000/5000 м — дистанция, на
 * которой период соответствующей шкалы (40 м / 7 м) опускается ниже ~1
 * экранного пикселя (1080p, fov ~50°). uDetailLayerGates — по-слойные
 * uniform-гейты (одинаковы для всех пикселей драв-колла). Ветка
 * `if (max(fade1, fade2) > 0.0)` — другое: viewDistance попиксельна, поэтому
 * дивергентна и она. texture()-выборки внутри дивергентного потока формально
 * UB по производным (dFdx/dFdy), практически безвредно: helper-инвокации на
 * границе всё равно исполняются и дают корректные производные, а вклад на
 * самой кромке умножается на fade → 0. sampleDetiled сам берёт производные
 * ДО стохастического сдвига (см. выше) — этот аргумент их не портит.
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
  // Хеш целочисленной ячейки → vec2 в [0,1). Две независимые проекции dot
  // (классика IQ) — от КВАНТОВАННОЙ (floor) величины, см. докстрока чанка.
  vec2 hashCell2(vec2 cell) {
    vec2 h = vec2(
      dot(cell, vec2(127.1, 311.7)),
      dot(cell, vec2(269.5, 183.3))
    );
    return fract(sin(h) * 43758.5453);
  }

  // Стохастическая детайлизация одной карты (IQ «texture repetition», 2-тап
  // вариант): бленд текущей ячейки и диагонального соседа со стороны, куда
  // указывает дробная часть uv, весом smoothstep от близости к диагональной
  // границе. Производные — от ИСХОДНОГО uv, общие для обеих выборок
  // (texture2DGradEXT → textureGrad, см. докстрока чанка).
  vec4 sampleDetiled(sampler2D map, vec2 uv) {
    vec2 ddx = dFdx(uv);
    vec2 ddy = dFdy(uv);

    vec2 cell = floor(uv);
    vec2 f = uv - cell;

    vec2 dir = sign(f - 0.5);
    vec2 neighborCell = cell + dir;

    vec2 randA = hashCell2(cell);
    vec2 randB = hashCell2(neighborCell);

    // Знаковый флип одной оси на ячейку — дешёвая доп. развязка соседних
    // вариантов (задание владельца). LOD от textureGrad не зависит от знака
    // производной (использует её длину), флип на выбор мипа не влияет.
    vec2 flipA = vec2(randA.x > 0.5 ? -1.0 : 1.0, 1.0);
    vec2 flipB = vec2(randB.x > 0.5 ? -1.0 : 1.0, 1.0);

    vec2 uvA = uv * flipA + randA * 37.0;
    vec2 uvB = uv * flipB + randB * 37.0;

    // 0 в центре ячейки, 1 на диагональной границе — произведение по двум
    // осям даёт ноль всюду, кроме окрестности диагонального угла
    vec2 edge = abs(f - 0.5) * 2.0;
    float blend = smoothstep(0.2, 0.8, edge.x * edge.y);

    vec4 colA = texture2DGradEXT(map, uvA, ddx, ddy);
    vec4 colB = texture2DGradEXT(map, uvB, ddx, ddy);
    return mix(colA, colB, blend);
  }

  // Стохастические обёртки террейна: те же 3 планарные проекции, что и
  // классические triplanarAlbedo/Arm/Normal, но каждая читается через
  // sampleDetiled вместо прямой выборки. Бленд трёх проекций — ОБЩЕЕ ядро
  // из чанка TriplanarDetail (triplanarBlendRgb/Normal), не копия.
  vec3 triplanarAlbedoDetiled(sampler2D map, vec3 p, vec3 w, vec2 offset) {
    vec3 cx = sampleDetiled(map, p.zy * uDetailScale + offset).rgb;
    vec3 cy = sampleDetiled(map, p.xz * uDetailScale + offset).rgb;
    vec3 cz = sampleDetiled(map, p.xy * uDetailScale + offset).rgb;
    return triplanarBlendRgb(cx, cy, cz, w);
  }

  vec3 triplanarArmDetiled(sampler2D map, vec3 p, vec3 w, vec2 offset) {
    vec3 ax = sampleDetiled(map, p.zy * uDetailScale + offset).rgb;
    vec3 ay = sampleDetiled(map, p.xz * uDetailScale + offset).rgb;
    vec3 az = sampleDetiled(map, p.xy * uDetailScale + offset).rgb;
    return triplanarBlendRgb(ax, ay, az, w);
  }

  vec3 triplanarNormalDetiled(sampler2D map, vec3 p, vec3 n, vec3 w, vec2 offset) {
    vec3 tx = sampleDetiled(map, p.zy * uDetailScale + offset).xyz * 2.0 - 1.0;
    vec3 ty = sampleDetiled(map, p.xz * uDetailScale + offset).xyz * 2.0 - 1.0;
    vec3 tz = sampleDetiled(map, p.xy * uDetailScale + offset).xyz * 2.0 - 1.0;
    return triplanarBlendNormal(tx, ty, tz, n, w);
  }

  void applyTerrainDetail(inout vec3 nLocal, inout vec3 albedoMul, vec3 dirLocal, float viewDistance) {
    // Пороги фейда — ручки пер-тела в метрах дистанции, сконвертированные
    // в юниты на CPU (см. докстрока чанка и PlanetShader.uDetailFadeRange).
    float fade1 = 1.0 - smoothstep(uDetailFadeRange.x, uDetailFadeRange.y, viewDistance);
    float fade2 = uDetailLayerGates.z * (1.0 - smoothstep(uDetailFadeRange.z, uDetailFadeRange.w, viewDistance));

    if (max(fade1, fade2) > 0.0) {
      vec2 offset = vec2(0.0);
      vec3 w = triplanarWeights(dirLocal);

      if (fade1 > 0.0) {
        vec3 nDetail = triplanarNormalDetiled(uDetailNorMap, dirLocal, nLocal, w, offset);
        nLocal = normalize(nLocal + uDetailNormalScale * fade1 * (nDetail - nLocal));

        if (uDetailLayerGates.x > 0.0) {
          float aoDetail = mix(1.0, triplanarArmDetiled(uDetailArmMap, dirLocal, w, offset).r, uDetailAoInfluence);
          albedoMul *= mix(1.0, aoDetail, fade1);
        }

        if (uDetailLayerGates.y > 0.0) {
          vec3 diffuseDetail = triplanarAlbedoDetiled(uDetailDiffMap, dirLocal, w, offset);
          float lum = dot(diffuseDetail, vec3(0.299, 0.587, 0.114));
          vec3 tint = mix(vec3(lum), diffuseDetail, uDetailSaturation) * uDetailBrightness;
          albedoMul *= mix(vec3(1.0), tint, fade1);
        }
      }

      if (fade2 > 0.0) {
        // Ратио масштабов вместо своего texture2D: triplanarNormalDetiled
        // сам умножит p на uDetailScale — предварительное домножение на
        // uDetailScale2/uDetailScale компенсирует разницу и даёт эффективный
        // масштаб uDetailScale2.
        vec3 pSmall = dirLocal * (uDetailScale2 / max(uDetailScale, 1e-6));
        vec3 nDetail2 = triplanarNormalDetiled(uDetailNor2Map, pSmall, nLocal, w, offset);
        nLocal = normalize(nLocal + uDetailNormalScale * fade2 * (nDetail2 - nLocal));
      }
    }
  }
`
