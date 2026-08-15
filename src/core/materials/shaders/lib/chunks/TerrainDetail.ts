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
 * тайла на холмах). Обе шкалы (крупная и мелкая нормаль) читаются через
 * стохастические обёртки triplanarNormalDetiled/ArmDetiled/AlbedoDetiled
 * (ниже) вместо классических triplanarNormal/Arm/Albedo.
 *
 * Раунд 1 фикса: первая версия (текущая ячейка uv + диагональный сосед по
 * floor(uv)) была РАЗРЫВНА на каждой границе ячейки — при переходе floor(uv)
 * обе выборки скачком меняют UV, а blend-вес это не компенсирует (переход
 * ячейки не совпадает с переходом веса). Заменено непрерывной схемой IQ
 * technique 3 / Suslik: индекс варианта — не floor(uv) самой текстуры, а
 * floor(l), где l = 8·vnoise(0.3·uv) — НЕПРЕРЫВНАЯ скалярная функция позиции
 * (value noise, без текстур). floor(l) меняется РОВНО там, где fract(l)
 * проходит через 0 — а в этой точке smoothstep-вес уже полностью на стороне
 * входящего варианта (b→1 перед переходом при fract→1, b→0 сразу после при
 * fract→0 для НОВОГО floor(l), но это тот же вариант: offB старого интервала
 * hash(ia+1) численно равен offA нового интервала hash(ia_new) = hash(ia+1)).
 * Результат непрерывен по построению, свободен от сеточных швов.
 *
 * Экономика: l — не текстурная выборка, а ALU (vnoise — 4 хеша + билинейный
 * mix), и он НЕ зависит от конкретной карты — один l на ПРОЕКЦИОННУЮ ОСЬ
 * (zy/xz/xy), общий для всех 4 карт (крупная нормаль, ARM, diffuse, мелкая
 * нормаль): 3 вызова vnoise на пиксель суммарно, не 4×3. Единый l на карту
 * важен и содержательно — все слои переключают вариант синхронно в одном
 * месте, а не вразнобой.
 *
 * Знаковый флип оси (был в раунде 0) убран целиком: он зеркалил тангенциальную
 * нормаль без компенсации соответствующей компоненты (ложные «вдавленные»
 * ячейки на ~половине выборок) и был избыточен — стохастический uv-сдвиг
 * (hash22) уже даёт полную развязку соседних вариантов без флипа. С флипом
 * ушёл и риск зеркалированного анизотропного футпринта: ddx/ddy остаются
 * честными производными при чистом сдвиге uv.
 *
 * Хеш — по-прежнему от КВАНТОВАННОЙ величины на каждом вызове: floor(p) в
 * vnoise (углы ячейки value noise), floor(l)/floor(l)+1 в sampleDetiled
 * (индекс варианта) — не от сырого варьинга (см. Noise.ts, hashSurface11:
 * ULP-джиттер интерполяции усиливается градиентом хеша до пиксельного шума).
 *
 * БЮДЖЕТ (худший случай, обе шкалы + все три канала крупной): было 12 выборок
 * (3 проекции × 4 карты, по одной выборке каждая); стохастика удваивает
 * каждую планарную выборку (2 варианта вместо одного) — 3 проекции × 2
 * варианта × 4 карты (норм. крупная, ARM, diffuse, норм. мелкая) = 24
 * выборки текстур на пиксель. Плюс 3 вызова vnoise (ALU, не выборки текстур,
 * см. «Экономика» выше). Fade по дистанции (ниже) — единственная защита от
 * оплаты этого бюджета там, где деталь всё равно не читается.
 *
 * triplanarNormalDetiled/ArmDetiled/AlbedoDetiled читают масштаб из
 * ГЛОБАЛЬНОГО uDetailScale (см. чанк TriplanarDetail — сэмплер первым
 * параметром, масштаб — нет). Для мелкой шкалы домен предварительно
 * домножается на uDetailScale2/uDetailScale, так что внутреннее p*uDetailScale
 * даёт тот же результат, что и p*uDetailScale2 напрямую — функции
 * переиспользуются без копирования бленда под вторую шкалу (задача 3:
 * чужой бленд не копируем, зовём чужую функцию). Общий l (см. выше) вычислен
 * из домена КРУПНОЙ шкалы и переиспользуется мелкой — вариант мелкой карты
 * переключается на частоте крупной оси, это осознанное упрощение ради ALU.
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
 * самой кромке умножается на fade → 0. Производные для sampleDetiled берутся
 * ДО стохастического сдвига (см. её докстроку) — этот аргумент их не портит.
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
  // Скалярный/векторный хеш — от КВАНТОВАННОЙ величины на вызове (floor(p)
  // передаёт вызывающая сторона), не от сырого варьинга.
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec2 hash22(vec2 p) {
    vec2 h = vec2(
      dot(p, vec2(127.1, 311.7)),
      dot(p, vec2(269.5, 183.3))
    );
    return fract(sin(h) * 43758.5453);
  }

  // Value noise — непрерывная скалярная функция без текстур: билинейный mix
  // хешей четырёх углов ячейки floor(p) по Hermite-сглаженной дробной части.
  // Нужна как НЕПРЕРЫВНЫЙ индекс варианта для sampleDetiled — см. её докстроку.
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Стохастическая детайлизация одной карты — непрерывный 2-тап (IQ «texture
  // repetition» technique 3 / Suslik): вариант выбирается НЕ ячейкой самого
  // uv (та схема разрывна на каждой границе ячейки текстуры — раунд 0), а
  // floor(l)/fract(l) НЕПРЕРЫВНОГО индекса l (см. вызывающую сторону —
  // applyTerrainDetail считает l = 8·vnoise(0.3·uv) один раз на ось). floor(l)
  // меняется РОВНО там, где fract(l) проходит через 0 — в этой точке вес b
  // уже полностью переключён на входящий вариант (offB текущего интервала ==
  // offA следующего, оба — hash22 одного и того же floor(l)+1), поэтому
  // результат непрерывен по построению. Производные (ddx/ddy) — от ИСХОДНОГО
  // uv, посчитаны вызывающей стороной ДО стохастического сдвига offA/offB —
  // иначе выбор мипа скачет вместе со сдвигом и на переходах виден шов.
  vec4 sampleDetiled(sampler2D map, vec2 uv, vec2 ddx, vec2 ddy, float l) {
    float ia = floor(l);
    float f = fract(l);
    vec2 offA = hash22(vec2(ia, 3.0));
    vec2 offB = hash22(vec2(ia + 1.0, 3.0));
    float b = smoothstep(0.2, 0.8, f);
    vec4 colA = texture2DGradEXT(map, uv + offA, ddx, ddy);
    vec4 colB = texture2DGradEXT(map, uv + offB, ddx, ddy);
    return mix(colA, colB, b);
  }

  // Стохастические обёртки террейна: те же 3 планарные проекции, что и
  // классические triplanarAlbedo/Arm/Normal, но каждая читается через
  // sampleDetiled вместо прямой выборки. l — общий индекс на ось (см.
  // докстроку чанка), делится всеми четырьмя картами и обеими шкалами.
  // Бленд трёх проекций — ОБЩЕЕ ядро из чанка TriplanarDetail
  // (triplanarBlendRgb/Normal), не копия.
  vec3 triplanarAlbedoDetiled(sampler2D map, vec3 p, vec3 w, vec2 offset, vec3 l) {
    vec2 uvZY = p.zy * uDetailScale + offset;
    vec2 uvXZ = p.xz * uDetailScale + offset;
    vec2 uvXY = p.xy * uDetailScale + offset;
    vec3 cx = sampleDetiled(map, uvZY, dFdx(uvZY), dFdy(uvZY), l.x).rgb;
    vec3 cy = sampleDetiled(map, uvXZ, dFdx(uvXZ), dFdy(uvXZ), l.y).rgb;
    vec3 cz = sampleDetiled(map, uvXY, dFdx(uvXY), dFdy(uvXY), l.z).rgb;
    return triplanarBlendRgb(cx, cy, cz, w);
  }

  vec3 triplanarArmDetiled(sampler2D map, vec3 p, vec3 w, vec2 offset, vec3 l) {
    vec2 uvZY = p.zy * uDetailScale + offset;
    vec2 uvXZ = p.xz * uDetailScale + offset;
    vec2 uvXY = p.xy * uDetailScale + offset;
    vec3 ax = sampleDetiled(map, uvZY, dFdx(uvZY), dFdy(uvZY), l.x).rgb;
    vec3 ay = sampleDetiled(map, uvXZ, dFdx(uvXZ), dFdy(uvXZ), l.y).rgb;
    vec3 az = sampleDetiled(map, uvXY, dFdx(uvXY), dFdy(uvXY), l.z).rgb;
    return triplanarBlendRgb(ax, ay, az, w);
  }

  vec3 triplanarNormalDetiled(sampler2D map, vec3 p, vec3 n, vec3 w, vec2 offset, vec3 l) {
    vec2 uvZY = p.zy * uDetailScale + offset;
    vec2 uvXZ = p.xz * uDetailScale + offset;
    vec2 uvXY = p.xy * uDetailScale + offset;
    vec3 tx = sampleDetiled(map, uvZY, dFdx(uvZY), dFdy(uvZY), l.x).xyz * 2.0 - 1.0;
    vec3 ty = sampleDetiled(map, uvXZ, dFdx(uvXZ), dFdy(uvXZ), l.y).xyz * 2.0 - 1.0;
    vec3 tz = sampleDetiled(map, uvXY, dFdx(uvXY), dFdy(uvXY), l.z).xyz * 2.0 - 1.0;
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

      // Непрерывный индекс варианта — один раз на проекционную ось, делится
      // всеми четырьмя картами обеих шкал (см. «Экономика» в докстроке чанка).
      vec3 l = vec3(
        8.0 * vnoise(0.3 * (dirLocal.zy * uDetailScale + offset)),
        8.0 * vnoise(0.3 * (dirLocal.xz * uDetailScale + offset)),
        8.0 * vnoise(0.3 * (dirLocal.xy * uDetailScale + offset))
      );

      if (fade1 > 0.0) {
        vec3 nDetail = triplanarNormalDetiled(uDetailNorMap, dirLocal, nLocal, w, offset, l);
        nLocal = normalize(nLocal + uDetailNormalScale * fade1 * (nDetail - nLocal));

        if (uDetailLayerGates.x > 0.0) {
          float aoDetail = mix(
            1.0,
            triplanarArmDetiled(uDetailArmMap, dirLocal, w, offset, l).r,
            uDetailAoInfluence
          );
          albedoMul *= mix(1.0, aoDetail, fade1);
        }

        if (uDetailLayerGates.y > 0.0) {
          vec3 diffuseDetail = triplanarAlbedoDetiled(uDetailDiffMap, dirLocal, w, offset, l);
          float lum = dot(diffuseDetail, vec3(0.299, 0.587, 0.114));
          vec3 tint = mix(vec3(lum), diffuseDetail, uDetailSaturation) * uDetailBrightness;
          albedoMul *= mix(vec3(1.0), tint, fade1);
        }
      }

      if (fade2 > 0.0) {
        // Ратио масштабов вместо своего texture2D: triplanarNormalDetiled
        // сам умножит p на uDetailScale — предварительное домножение на
        // uDetailScale2/uDetailScale компенсирует разницу и даёт эффективный
        // масштаб uDetailScale2. l переиспользован из крупной шкалы (см.
        // докстроку чанка) — своего vnoise для мелкой шкалы нет.
        vec3 pSmall = dirLocal * (uDetailScale2 / max(uDetailScale, 1e-6));
        vec3 nDetail2 = triplanarNormalDetiled(uDetailNor2Map, pSmall, nLocal, w, offset, l);
        nLocal = normalize(nLocal + uDetailNormalScale * fade2 * (nDetail2 - nLocal));
      }
    }
  }
`
