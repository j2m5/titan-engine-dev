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
 * (triplanarWeights/triplanarBlendRgb/triplanarBlendNormal). Домен адресации
 * текстур — атрибуты detailPos/detailPos2 (varying vDetailPos/vDetailPos2,
 * см. PlanetShaderTemplate): точная тело-локальная позиция вершины минус
 * k·W патча (k общий на патч, W = WRAP_TILES периодов слоя, см.
 * detailWrap.ts) — не единичный dirLocal, чей float32 не различает соседние
 * тексели 40/7-метровых тайлов на теле планетного радиуса. Период честный
 * в метрах, без поправки на радиус. Веса трипланара (triplanarWeights) и
 * общая нормаль (nLocal) по-прежнему берутся от dirLocal/нормали — это
 * ориентация, не адресация карты. Любая новая функция, читающая эти позиции
 * (включая vnoise ниже), обязана быть W-периодичной — иначе обёртка вносит
 * шов на границе k.
 *
 * СТОХАСТИЧЕСКИЙ АНТИ-ТАЙЛИНГ: обе шкалы (крупная и мелкая нормаль) читаются
 * через стохастические обёртки triplanarNormalDetiled/ArmDetiled/AlbedoDetiled
 * (ниже) вместо классических triplanarNormal/Arm/Albedo — компенсирует повтор
 * текстурного тайла на больших ровных участках рельефа.
 *
 * Индекс варианта — не floor(uv) самой текстуры (та ячейка разрывна на
 * КАЖДОЙ своей границе: обе выборки скачком меняют UV ровно там, где
 * blend-вес их не компенсирует), а floor(l) НЕПРЕРЫВНОЙ скалярной функции
 * позиции l = 8·vnoise(0.25·uv) (IQ «texture repetition» technique 3 /
 * Suslik, value noise без текстур). floor(l) меняется РОВНО там, где fract(l)
 * проходит через 0 — а в этой точке smoothstep-вес уже полностью на стороне
 * входящего варианта (offB текущего интервала — hash22 от floor(l)+1 —
 * численно равен offA следующего интервала, вычисленному от того же
 * floor(l)+1), поэтому результат непрерывен по построению и свободен от
 * сеточных швов.
 *
 * Экономика: l — не текстурная выборка, а ALU (vnoise — 4 хеша + билинейный
 * mix), и он НЕ зависит от конкретной карты — один l на ПРОЕКЦИОННУЮ ОСЬ
 * (zy/xz/xy), общий для всех 4 карт (крупная нормаль, ARM, diffuse, мелкая
 * нормаль): 3 вызова vnoise на пиксель суммарно, не 4×3. Единый l на карту
 * важен и содержательно — все слои переключают вариант синхронно в одном
 * месте, а не вразнобой.
 *
 * Стохастический uv-сдвиг (hash22) — единственный механизм развязки соседних
 * вариантов: тангенциальная нормаль не зеркалится и компенсации не требует,
 * ddx/ddy остаются честными производными при чистом сдвиге uv.
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
 * triplanarNormalDetiled/ArmDetiled/AlbedoDetiled принимают масштаб явным
 * параметром scale (а не читают глобальный uDetailScale) — крупный слой
 * зовётся с (detailPos, uDetailScale), мелкий (только нормаль) — со своей
 * позицией (detailPos2, uDetailScale2): функции переиспользуются без
 * копирования бленда под вторую шкалу. Общий l (см. выше) вычислен из
 * домена КРУПНОЙ шкалы и переиспользуется мелкой — вариант мелкой карты
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
 * дивергентна и она. Текстурные градиенты (dFdx/dFdy) считаются через
 * triplanarUvFor (см. «ЗОНЫ МАТЕРИАЛА») сразу после w/l — ДО ВСЕХ
 * ВНУТРЕННИХ ветвлений (fade1/fade2 и маска зон m ниже) — и передаются в
 * sampleDetiled/triplanar*Detiled явно параметром TriplanarUv, а не
 * пересчитываются внутри условных веток. Сам вызов triplanarUvFor физически
 * остаётся ВНУТРИ внешней `if (max(fade1, fade2) > 0.0)` (иначе она не
 * защищала бы от расчёта детали там, где деталь не видна вообще — см. её
 * смысл выше) — эта внешняя граница НЕ устранена и UB на ней тот же, что
 * был всегда: viewDistance плавная по экрану (не шумовая), соседние
 * инвокации квада почти всегда на одной стороне границы, а редкий случай на
 * самой кромке умножается на fade → 0 — практически безвредно, как и до
 * фикса. Устранено ДРУГОЕ: раньше (до фикс-раунда 2) производные считались
 * ещё и ВНУТРИ fade1/маски — там, где маска m ветвится на ПИКСЕЛЬНОЙ частоте
 * (шумовая breakup-граница, не плавная viewDistance), и там UB был ВИДИМ —
 * мип-волоски вдоль изоконтуров m = STEEP_EPS / 1-EPS (фикс-раунд 2). Вынос
 * закрывает именно этот класс — внутренние, пиксельно-частые ветвления, не
 * внешнюю fade-границу. Производные для sampleDetiled по-прежнему берутся
 * ДО стохастического сдвига offA/offB (см. её докстроку) — вынос выше этот
 * аргумент не портит.
 *
 * ЗОНЫ МАТЕРИАЛА ПО УКЛОНУ (крупная шкала, fade1-ветка; мелкая шкала задачи 4
 * зон не знает — см. её код ниже, вне маски). Второй набор карт (uSteep*)
 * читается тем же доменом адресации, что родной (тот же detailPos/scale/w/l —
 * зона меняет ТЕКСТУРЫ, не проекцию и не индекс варианта sampleDetiled).
 * Маска m ∈ [0,1] — smoothstep по tan уклона (slopeTan, аргумент функции;
 * приходит из PlanetShaderTemplate — декод той же slope-карты, что и
 * perturbNormalFromSlope, см. её докстроку) с рваной границей: к порогам
 * uSteepMask.xy прибавлен uSteepMask.z·(l.z/8.0 − 0.5) — домен и ось те же,
 * что у l.z (detailPos.xy·uDetailScale, та же W-периодичность 1024, что у l
 * выше), готовое значение просто переиспользуется делением на 8 (обратное
 * домножению в определении l) — ни нового vnoise, ни новой выборки текстуры;
 * граница зоны не обязана совпадать с фазой l, но математически это та же
 * функция позиции. Множитель uSteepGate — часть
 * произведения самой маски (рулинг: не отдельный if), поэтому m ≡ 0 при
 * выключенном/неполном steep-наборе (Task 3 гарантирует это на CPU) —
 * дальше работает только ветка STEEP_EPS-ниже, значения численно совпадают
 * с кодом до этой задачи.
 *
 * Ветвление на STEEP_EPS (0.003) — не оптимизация читаемости, а экономия
 * бюджета: без него компилятор обязан читать ОБА набора на каждом пикселе,
 * даже там, где второй даёт вклад 0 (m точно 0 или 1 почти никогда из-за
 * шумовой границы и float, поэтому голый `m > 0.0`/`m < 1.0` не разрежал бы
 * ничего). Три ветки: m < EPS — только родной набор (одна выборка на
 * распаковку), m > 1-EPS — только steep, иначе — обе. Общее чтение тройки
 * (нормаль/AO/тинт-diffuse) вынесено в sampleDetailSet — тело идентично
 * старому коду ветки fade1, просто параметризовано тремя сэмплерами; звать
 * его 1 раз (края маски) или 2 (полоса перехода) вместо копипаста.
 *
 * Бленд в полосе перехода: нормали — тот же whiteout-паттерн, что уже
 * применяется между крупной и мелкой шкалой (nLocal = normalize(nLocal +
 * k·(nDetail − nLocal)), последовательно родной вес (1−m), затем steep вес
 * m — а не единая интерполяция двух нормалей, которая укорачивает вектор
 * ближе к краям сферы Buhler). AO/tint — не направления, им whiteout не
 * нужен, обычный mix(native, steep, m).
 *
 * БЮДЖЕТ ПОЛОСЫ (худший случай, обе шкалы + все три канала крупной, ОБА
 * набора крупной шкалы одновременно): 3 карты (нормаль/ARM/диффуз) × 3
 * проекции × 2 стохастических варианта × 2 набора (родной + steep) = 36,
 * плюс мелкая шкала (одна нормаль, зон не знает) 3 × 2 × 1 = 6 — итого 42
 * против 24 вне полосы (см. БЮДЖЕТ выше). Полоса — по построению узкая
 * (ширина ~uSteepMask.y − uSteepMask.x, ручка Task 3), поэтому среднее по
 * кадру ближе к 24, чем к 42.
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
  uniform sampler2D uSteepNorMap;
  uniform sampler2D uSteepArmMap;
  uniform sampler2D uSteepDiffMap;
  // 0/1 по факту наличия всех трёх steep-карт И несовпадения с родным
  // набором (rocky-тела — вырожденный бленд, гейт держит Task 3 на CPU).
  uniform float uSteepGate;
  // x = steepStart, y = steepFull, z = steepBreakup — tan-единицы уклона
  // (см. докстроку чанка, раздел «ЗОНЫ МАТЕРИАЛА»; резолвит Task 3).
  uniform vec3 uSteepMask;
`

export const terrainDetailFunctions = `
  // Полуширина ветвления маски зон (см. докстроку чанка, «ЗОНЫ МАТЕРИАЛА»):
  // < EPS/> 1-EPS читает один набор, между ними — оба.
  #define STEEP_EPS 0.003

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
  // Решётка хеша — по модулю 256 ячеек: p приходит из детального домена
  // (detailPos*scale, ячейка 4 тайла из-за множителя 0.25 в applyTerrainDetail)
  // — 256×4 = 1024 = WRAP_TILES (detailWrap.ts), поэтому шов обёртки k·W
  // домена невидим для vnoise. Сосед сворачивается ОТДЕЛЬНО от базовой ячейки
  // (i1 = mod(i + 1.0, 256.0)), а не как (i + 1) от уже свёрнутого i — иначе
  // правый угол ячейки 255 хешируется от 256, а левый угол ячейки 0 (тот же
  // физический угол решётки) — от 0: разные хеши одной точки дают разрыв l
  // на каждой границе периода.
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 i0 = mod(i, 256.0);
    vec2 i1 = mod(i + 1.0, 256.0);
    float a = hash21(i0);
    float b = hash21(vec2(i1.x, i0.y));
    float c = hash21(vec2(i0.x, i1.y));
    float d = hash21(i1);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Стохастическая детайлизация одной карты — непрерывный 2-тап (IQ «texture
  // repetition» technique 3 / Suslik): вариант выбирается НЕ ячейкой самого
  // uv (та схема разрывна на каждой границе ячейки текстуры), а
  // floor(l)/fract(l) НЕПРЕРЫВНОГО индекса l (см. вызывающую сторону —
  // applyTerrainDetail считает l = 8·vnoise(0.25·uv) один раз на ось). floor(l)
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

  // Группа uv + производные для трёх планарных проекций (zy/xz/xy) ОДНОГО
  // домена (p*scale). Вычисляется в triplanarUvFor ниже — ОДИН раз, в
  // однородном потоке, до любых ветвлений по fade/маске (см. докстроку
  // чанка) — dFdx/dFdy под дивергентным потоком формально UB, а маска зон
  // ветвится на пиксельной частоте, где UB был видимым (мип-волоски).
  struct TriplanarUv {
    vec2 zy; vec2 zyDx; vec2 zyDy;
    vec2 xz; vec2 xzDx; vec2 xzDy;
    vec2 xy; vec2 xyDx; vec2 xyDy;
  };

  TriplanarUv triplanarUvFor(vec3 p, float scale) {
    TriplanarUv t;
    t.zy = p.zy * scale;
    t.xz = p.xz * scale;
    t.xy = p.xy * scale;
    t.zyDx = dFdx(t.zy);
    t.zyDy = dFdy(t.zy);
    t.xzDx = dFdx(t.xz);
    t.xzDy = dFdy(t.xz);
    t.xyDx = dFdx(t.xy);
    t.xyDy = dFdy(t.xy);
    return t;
  }

  // Стохастические обёртки террейна: те же 3 планарные проекции, что и
  // классические triplanarAlbedo/Arm/Normal, но каждая читается через
  // sampleDetiled вместо прямой выборки. l — общий индекс на ось (см.
  // докстроку чанка), делится всеми четырьмя картами и обеими шкалами.
  // uv+производные приходят готовыми (TriplanarUv, см. выше) — обёртки сами
  // больше не считают dFdx/dFdy, только читают текстуру. Один и тот же t
  // обслуживает оба набора крупной шкалы (родной/steep — зона меняет
  // ТЕКСТУРЫ, не домен адресации) и, с другим t (от detailPos2/uDetailScale2),
  // мелкую шкалу — функции переиспользуются без копирования бленда. Бленд
  // трёх проекций — ОБЩЕЕ ядро из чанка TriplanarDetail (triplanarBlendRgb/
  // Normal), не копия.
  vec3 triplanarAlbedoDetiled(sampler2D map, TriplanarUv t, vec3 w, vec3 l) {
    vec3 cx = sampleDetiled(map, t.zy, t.zyDx, t.zyDy, l.x).rgb;
    vec3 cy = sampleDetiled(map, t.xz, t.xzDx, t.xzDy, l.y).rgb;
    vec3 cz = sampleDetiled(map, t.xy, t.xyDx, t.xyDy, l.z).rgb;
    return triplanarBlendRgb(cx, cy, cz, w);
  }

  vec3 triplanarArmDetiled(sampler2D map, TriplanarUv t, vec3 w, vec3 l) {
    vec3 ax = sampleDetiled(map, t.zy, t.zyDx, t.zyDy, l.x).rgb;
    vec3 ay = sampleDetiled(map, t.xz, t.xzDx, t.xzDy, l.y).rgb;
    vec3 az = sampleDetiled(map, t.xy, t.xyDx, t.xyDy, l.z).rgb;
    return triplanarBlendRgb(ax, ay, az, w);
  }

  vec3 triplanarNormalDetiled(sampler2D map, TriplanarUv t, vec3 n, vec3 w, vec3 l) {
    vec3 tx = sampleDetiled(map, t.zy, t.zyDx, t.zyDy, l.x).xyz * 2.0 - 1.0;
    vec3 ty = sampleDetiled(map, t.xz, t.xzDx, t.xzDy, l.y).xyz * 2.0 - 1.0;
    vec3 tz = sampleDetiled(map, t.xy, t.xyDx, t.xyDy, l.z).xyz * 2.0 - 1.0;
    return triplanarBlendNormal(tx, ty, tz, n, w);
  }

  // Общее чтение тройки (нормаль/AO/tint-diffuse) для ОДНОГО набора крупной
  // шкалы (родного или steep) — тело идентично прежнему коду ветки fade1,
  // параметризовано сэмплерами набора. Гейты AO/diffuse — те же
  // uDetailLayerGates.x/y, общие на оба набора (свойство слоя, не зоны).
  // t/w/l не параметризованы по зоне — зона не меняет домен адресации (см.
  // докстроку чанка, «ЗОНЫ МАТЕРИАЛА»), только сами карты. t — готовый
  // TriplanarUv, посчитанный ДО ветвления по маске (см. applyTerrainDetail) —
  // сама функция dFdx/dFdy не считает.
  void sampleDetailSet(
    sampler2D nor, sampler2D arm, sampler2D diff, TriplanarUv t, vec3 w, vec3 l, vec3 nLocal,
    out vec3 nOut, out float aoOut, out vec3 tintOut
  ) {
    nOut = triplanarNormalDetiled(nor, t, nLocal, w, l);

    aoOut = 1.0;
    if (uDetailLayerGates.x > 0.0) {
      aoOut = mix(1.0, triplanarArmDetiled(arm, t, w, l).r, uDetailAoInfluence);
    }

    tintOut = vec3(1.0);
    if (uDetailLayerGates.y > 0.0) {
      vec3 diffuseDetail = triplanarAlbedoDetiled(diff, t, w, l);
      float lum = dot(diffuseDetail, vec3(0.299, 0.587, 0.114));
      tintOut = mix(vec3(lum), diffuseDetail, uDetailSaturation) * uDetailBrightness;
    }
  }

  void applyTerrainDetail(inout vec3 nLocal, inout vec3 albedoMul, vec3 dirLocal, vec3 detailPos, vec3 detailPos2, float viewDistance, float slopeTan) {
    // Пороги фейда — ручки пер-тела в метрах дистанции, сконвертированные
    // в юниты на CPU (см. докстрока чанка и PlanetShader.uDetailFadeRange).
    float fade1 = 1.0 - smoothstep(uDetailFadeRange.x, uDetailFadeRange.y, viewDistance);
    float fade2 = uDetailLayerGates.z * (1.0 - smoothstep(uDetailFadeRange.z, uDetailFadeRange.w, viewDistance));

    if (max(fade1, fade2) > 0.0) {
      // Веса трипланара — от направления (ориентация проекций), не от
      // домена адресации карт.
      vec3 w = triplanarWeights(dirLocal);

      // Непрерывный индекс варианта — один раз на проекционную ось, делится
      // всеми четырьмя картами обеих шкал (см. «Экономика» в докстроке чанка).
      // Домен — detailPos (крупная шкала); ячейка vnoise — 4 тайла (0.25),
      // решётка хеша mod 256 — вместе 1024 = WRAP_TILES, шов k·W не виден.
      vec3 l = vec3(
        8.0 * vnoise(0.25 * (detailPos.zy * uDetailScale)),
        8.0 * vnoise(0.25 * (detailPos.xz * uDetailScale)),
        8.0 * vnoise(0.25 * (detailPos.xy * uDetailScale))
      );

      // Текстурные градиенты — здесь, СРАЗУ после w/l, в однородном потоке:
      // ДО ветки по маске зон (пиксельная частота ветвления — там UB dFdx
      // под дивергентным потоком был ВИДИМ, мип-волоски вдоль изоконтуров
      // m = STEEP_EPS/1-EPS) и ДО fade1/fade2 (там UB почти безвреден, но
      // выносим единообразно — см. докстроку чанка). Обе шкалы — свой домен,
      // считаются здесь безусловно, даже если соответствующий fade окажется
      // < 0 ниже (дешёвая ALU, не текстурная выборка).
      TriplanarUv uvBig = triplanarUvFor(detailPos, uDetailScale);
      TriplanarUv uvSmall = triplanarUvFor(detailPos2, uDetailScale2);

      if (fade1 > 0.0) {
        // Маска зон: камень на крутом. breakup переиспользует l.z (домен и
        // ось те же — detailPos.xy·uDetailScale, см. l выше) делением на 8
        // (обратное домножению в определении l) — ни второго vnoise, ни
        // новых текстурных выборок. uSteepGate — множитель прямо в маске
        // (рулинг): выключенный/неполный steep-набор даёт m ≡ 0 и код ниже
        // сваливается в единственную ветку m < STEEP_EPS — родной набор,
        // как до этой задачи. Без slope-карты slopeTan = 0 (см. вызывающую
        // сторону, PlanetShaderTemplate) — тот же эффект.
        float m = uSteepGate * smoothstep(uSteepMask.x, uSteepMask.y, slopeTan + uSteepMask.z * (l.z / 8.0 - 0.5));

        vec3 nNative, nSteep;
        float aoNative, aoSteep;
        vec3 tintNative, tintSteep;

        if (m < STEEP_EPS) {
          // Вне зоны — читается ровно один (родной) набор.
          sampleDetailSet(uDetailNorMap, uDetailArmMap, uDetailDiffMap, uvBig, w, l, nLocal, nNative, aoNative, tintNative);
          nLocal = normalize(nLocal + uDetailNormalScale * fade1 * (nNative - nLocal));
          albedoMul *= mix(1.0, aoNative, fade1);
          albedoMul *= mix(vec3(1.0), tintNative, fade1);
        } else if (m > 1.0 - STEEP_EPS) {
          // Только steep — симметрично ветке выше.
          sampleDetailSet(uSteepNorMap, uSteepArmMap, uSteepDiffMap, uvBig, w, l, nLocal, nSteep, aoSteep, tintSteep);
          nLocal = normalize(nLocal + uDetailNormalScale * fade1 * (nSteep - nLocal));
          albedoMul *= mix(1.0, aoSteep, fade1);
          albedoMul *= mix(vec3(1.0), tintSteep, fade1);
        } else {
          // Полоса перехода: оба набора (бюджет — см. докстроку чанка).
          // Нормали — whiteout, последовательно родной вес (1-m), затем
          // steep вес m (тот же паттерн, что крупная/мелкая шкала ниже).
          // AO/tint — не направления, обычный mix(a, b, m).
          sampleDetailSet(uDetailNorMap, uDetailArmMap, uDetailDiffMap, uvBig, w, l, nLocal, nNative, aoNative, tintNative);
          nLocal = normalize(nLocal + uDetailNormalScale * fade1 * (1.0 - m) * (nNative - nLocal));

          sampleDetailSet(uSteepNorMap, uSteepArmMap, uSteepDiffMap, uvBig, w, l, nLocal, nSteep, aoSteep, tintSteep);
          nLocal = normalize(nLocal + uDetailNormalScale * fade1 * m * (nSteep - nLocal));

          albedoMul *= mix(1.0, mix(aoNative, aoSteep, m), fade1);
          albedoMul *= mix(vec3(1.0), mix(tintNative, tintSteep, m), fade1);
        }
      }

      if (fade2 > 0.0) {
        // Своя точная позиция мелкого слоя (detailPos2, W2 ≠ W1) — не ratio
        // от крупной, свой TriplanarUv (uvSmall, посчитан выше вместе с
        // uvBig). l переиспользован из крупной шкалы (см. докстроку чанка) —
        // своего vnoise для мелкой шкалы нет.
        vec3 nDetail2 = triplanarNormalDetiled(uDetailNor2Map, uvSmall, nLocal, w, l);
        nLocal = normalize(nLocal + uDetailNormalScale * fade2 * (nDetail2 - nLocal));
      }
    }
  }
`
