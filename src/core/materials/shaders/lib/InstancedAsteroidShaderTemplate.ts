import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, Vector3, Color } from 'three'

export const InstancedAsteroidShaderTemplate: ShaderProps = {
  uniforms: {
    lightPosition: new Uniform(new Vector3()),
    // Макро-облик — профиль (см. чанк AsteroidSurface / AsteroidProfiles)
    uRockColor: new Uniform(new Color(0x6b6157)),
    uColorJitter: new Uniform(0.12),
    uTintStrength: new Uniform(0.25),
    uMariaStrength: new Uniform(0.3),
    uSurfaceAmbient: new Uniform(0.03),
    uSpecularStrength: new Uniform(0.05),
    uSpecularPower: new Uniform(8.0),
    uSpecularTint: new Uniform(0.0),
    // Фотограмметрический PBR-микрослой (см. чанк TriplanarDetail); enabled 0 —
    // текстуры не загрузились, слой выключен
    uRockDiffMap: new Uniform(null),
    uRockNorMap: new Uniform(null),
    uRockArmMap: new Uniform(null),
    uDetailMapsEnabled: new Uniform(0),
    uDetailScale: new Uniform(1),
    uDetailSaturation: new Uniform(0.35),
    uDetailBrightness: new Uniform(1.6),
    uDetailNormalScale: new Uniform(1),
    uDetailAoInfluence: new Uniform(0.8),
    uDetailRoughInfluence: new Uniform(0.7),
    // Пылевая дымка (см. чанк RingDust). uDustDensity = 0 — туман выключен,
    // пока AsteroidRingSystem явно не сконфигурирует пыль.
    uDustColor: new Uniform(new Color(0x9b968c)),
    uDustDensity: new Uniform(0),
    uDustScaleHeight: new Uniform(1),
    uDustRingInner: new Uniform(0),
    uDustRingOuter: new Uniform(1e9),
    uDustCamRingPos: new Uniform(new Vector3()),
    uDustLightDirRing: new Uniform(new Vector3(1, 0, 0)),
    uDustAnglePower: new Uniform(2),
    uDustNearFade: new Uniform(1),
    uDustPlanetRadius: new Uniform(0),
    // Модель освещения камня (см. чанк AsteroidBrdf): реголит + planetshine
    uLunarMix: new Uniform(0.8),
    uOppositionSurge: new Uniform(0.3),
    uPlanetshineColor: new Uniform(new Color(0xb8ad9c)),
    uPlanetshineStrength: new Uniform(1.5),
    // Радиальный профиль пыли из альфы текстуры кольца; scale 0 — выключен
    uDustRadialMap: new Uniform(null),
    uDustRadialMapScale: new Uniform(0),
    // Деформация силуэта (см. чанк AsteroidShape). Амплитуда — per-instance из
    // диапазона [min,max]; min=max=0 → форма выключена.
    uShapeAmpMin: new Uniform(0),
    uShapeAmpMax: new Uniform(0),
    uShapeFreq: new Uniform(1),
    // Запечённые атрибуты породы (см. чанк AsteroidShape / ArchetypeShape.surfaceAt):
    // свежий скол разлома светлее/глаже, днища кратерных чаш затенены
    uFreshnessBrighten: new Uniform(0.15),
    uCavityShade: new Uniform(0.5)
  },
  vertexShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;
    uniform float uShapeAmpMin;
    uniform float uShapeAmpMax;
    uniform float uShapeFreq;

    // Per-instance fade [0..1] — плавные LOD/sector-переходы (см. InstancePool.writeFade)
    attribute float instanceFade;
    // Запечённые атрибуты породы из библиотеки архетипов (см. ArchetypeGeometry,
    // ArchetypeShape.surfaceAt): xy = freshness (скол разлома), cavity (кратерная
    // чаша); zw — резервные каналы, не прокидываются во фрагмент. Геометрии без
    // этого атрибута (WebGL default) дают (0,0,0,0) → модуляция ниже тихо нейтральна.
    attribute vec4 surfaceData;

    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vPlanetDirView;
    varying vec3 vRingPos;
    varying vec3 vObjectPos;
    varying vec3 vObjectNormal;
    varying mat3 vObjToView;
    varying float vFade;
    varying vec2 vSurfaceData;
    // Пер-инстансные хеши сида считаются ЗДЕСЬ и едут во фрагмент готовыми:
    // сырой сид через хеш во фрагментнике превращает ULP-джиттер интерполяции
    // в пиксельный шум («сетка» по фасетам). Джиттер самих значений (≤1e-6 без
    // хеш-усиления) визуально нулевой.
    varying float vTintSeed;
    varying vec3 vDomainOffset;
    varying vec2 vTriOffset;

    #include <noiseFunctions>
    #include <asteroidShapeFunctions>

    void main() {
      // Деформация силуэта: сид рисунка контура — хеш от позиции инстанса.
      // Амплитуда — второй, декоррелированный хеш той же позиции → каждый
      // камень получает свою «изрезанность» из диапазона [min,max].
      float shapeSeed = hash13(instanceMatrix[3].xyz);
      float ampSeed = hash13(instanceMatrix[3].xyz * 1.37 + 11.7);
      float shapeAmp = mix(uShapeAmpMin, uShapeAmpMax, ampSeed);
      vec3 shapedPos;
      vec3 shapedNormal;
      deformAsteroid(position, normal, shapeSeed, shapeAmp, shapedPos, shapedNormal);

      vec4 worldPosition = instanceMatrix * vec4(shapedPos, 1.0);
      vec4 mvPosition = modelViewMatrix * worldPosition;

      gl_Position = projectionMatrix * mvPosition;

      // Ring-local позиция фрагмента для модели пыли/тени (пофрагментная)
      vRingPos = worldPosition.xyz;

      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);
      mat3 instanceNormalMatrix = mat3(instanceMatrix);

      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vViewPosition = -mvPosition.xyz;
      // Направление на центр планеты (начало ring-local) во view — для planetshine
      vPlanetDirView = normalize((modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz - mvPosition.xyz);

      // Для макро-облика (см. чанк AsteroidSurface): объектная позиция (домен),
      // геом. нормаль объекта (нормаль больше не возмущается процедурно) и
      // матрица объект→view — трипланарная деталь (см. чанк TriplanarDetail)
      // применяется к геометрической нормали во фрагменте.
      vObjectPos = shapedPos;
      vObjectNormal = shapedNormal;
      vObjToView = normalMatrix * instanceNormalMatrix;
      vFade = instanceFade;
      // Freshness фасет разлома + cavity кратерных чаш из запекания (см. attribute
      // выше); резервные каналы zw не прокидываем
      vSurfaceData = surfaceData.xy;

      // Пер-инстансные хеши (см. комментарий у varyings): тинт, сдвиг домена
      // макро-шумов, сдвиг трипланарной проекции — из сида формы
      vTintSeed = hashSurface11(shapeSeed + 3.17);
      vDomainOffset = vec3(
        hashSurface11(shapeSeed + 1.1),
        hashSurface11(shapeSeed + 2.2),
        hashSurface11(shapeSeed + 3.3)
      ) * 40.0;
      vTriOffset = vec2(
        hashSurface11(shapeSeed + 7.7),
        hashSurface11(shapeSeed + 9.9)
      ) * 8.0;

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 uRockColor;
    uniform float uColorJitter;
    uniform float uTintStrength;
    uniform float uMariaStrength;
    uniform float uSurfaceAmbient;
    uniform float uSpecularStrength;
    uniform float uSpecularPower;
    uniform float uSpecularTint;
    uniform float uFreshnessBrighten;
    uniform float uCavityShade;
    uniform float uLunarMix;
    uniform float uOppositionSurge;
    uniform vec3 uPlanetshineColor;
    uniform float uPlanetshineStrength;

    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vPlanetDirView;
    varying vec3 vRingPos;
    varying vec3 vObjectPos;
    varying vec3 vObjectNormal;
    varying mat3 vObjToView;
    varying float vFade;
    varying vec2 vSurfaceData;
    // Готовые пер-инстансные хеши из вершинника (анти-ULP-джиттер, см. вершинник)
    varying float vTintSeed;
    varying vec3 vDomainOffset;
    varying vec2 vTriOffset;

    #include <noiseFunctions>
    #include <asteroidSurfaceFunctions>
    #include <asteroidBrdfFunctions>
    #include <triplanarDetailUniforms>
    #include <triplanarDetailFunctions>
    #include <ringDustUniforms>
    #include <ringDustFunctions>

    // Interleaved gradient noise (Jimenez) — экранный дизер для fade-переходов.
    float fadeDither(vec2 fragCoord) {
      return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      // Screen-door fade: непрозрачная геометрия гаснет упорядоченным дизером —
      // без сортировки, с сохранением depthWrite. Знак vFade кодирует направление
      // кросс-фейда: уходящий тир (vFade<0) берёт ИНВЕРТИРОВАННЫЙ порог, поэтому
      // его покрытие комплементарно входящему (vFade>0) — сумма ≈ полный камень
      // без «дыр» на середине перехода. |vFade|>=1 → порог не срабатывает.
      float fadeMag = abs(vFade);
      float fadeThresh = fadeDither(gl_FragCoord.xy);
      if (vFade < 0.0) fadeThresh = 1.0 - fadeThresh;
      if (fadeMag < fadeThresh) discard;

      vec3 surfDir = normalize(vObjectPos);

      // Макро-облик: альбедо (джиттер/мотл/maria), рельеф больше не возмущает
      // нормаль процедурно — нормаль геометрическая, деталь несёт PBR-микрослой.
      vec3 albedo = applyAsteroidSurface(surfDir, vTintSeed, vDomainOffset, uRockColor, uColorJitter, uTintStrength, uMariaStrength);

      // Геометрическая объектная нормаль; трипланарная дельта нормали (ниже)
      // применяется к ней. AO — единственный источник теперь ARM-карта микрослоя.
      vec3 objN = normalize(vObjectNormal);
      float surfAO = 1.0;

      // --- Фотограмметрический PBR-микрослой (трипланар, см. чанк TriplanarDetail) ---
      // Текстура = структура (яркость/нормаль/шероховатость), цвет = грейдинг
      // профиля. Пер-инстансный сдвиг проекции — против повторов пятен на соседях.
      float specStrength = uSpecularStrength;
      float specPower = uSpecularPower;
      if (uDetailMapsEnabled > 0.5) {
        vec3 geomN = normalize(vObjectNormal);
        vec3 triW = triplanarWeights(geomN);
        // Сдвиг проекции — готовый хеш из вершинника (анти-ULP-джиттер)
        vec2 triOffset = vTriOffset;

        // Альбедо: десатурированная структура текстуры × грейд профиля.
        // uDetailBrightness компенсирует среднюю яркость диффуза (< 1.0)
        vec3 detail = triplanarAlbedo(uRockDiffMap, vObjectPos, triW, triOffset);
        float detailLum = dot(detail, vec3(0.299, 0.587, 0.114));
        vec3 structureTint = mix(vec3(detailLum), detail, uDetailSaturation);
        albedo *= structureTint * uDetailBrightness;

        // Нормаль: тангенциальная дельта whiteout-нормали поверх геометрической —
        // микрорельеф ложится на форму, не искажая крупный силуэт
        vec3 nDetail = triplanarNormal(uRockNorMap, vObjectPos, geomN, triW, triOffset);
        objN = normalize(objN + uDetailNormalScale * (nDetail - geomN));

        // ARM: r=AO (умножается в каверн-AO), g=roughness (глушит блик)
        vec3 arm = triplanarArm(uRockArmMap, vObjectPos, triW, triOffset);
        surfAO *= mix(1.0, arm.r, uDetailAoInfluence);
        float gloss = 1.0 - arm.g * uDetailRoughInfluence;
        specStrength *= gloss;
        specPower = max(specPower * gloss, 2.0);
      }

      // Запечённые атрибуты породы: свежий скол разлома светлее и глаже
      // (меньше реголита), днища кратеров затенены (см. ArchetypeShape.surfaceAt)
      albedo *= 1.0 + uFreshnessBrighten * vSurfaceData.x;
      specStrength *= 1.0 + 0.5 * vSurfaceData.x;
      surfAO *= 1.0 - uCavityShade * vSurfaceData.y;

      // Объектная нормаль → view; учёт ориентации грани
      vec3 normal = normalize(vObjToView * objN);
      if (!gl_FrontFacing) normal = -normal;

      vec3 lightDirection = normalize(vViewLightDirection);
      vec3 viewDir = normalize(vViewPosition);
      float NdotL = dot(normal, lightDirection);
      float NdotV = dot(normal, viewDir);
      float cosPhase = dot(lightDirection, viewDir);

      // Диффуз реголита (см. чанк AsteroidBrdf): Ламберт/Ломмель-Зелигер по
      // профилю + оппозиционный пик — камень ровный по диску, с резким лимбом
      float lightIntensity = asteroidRegolithDiffuse(NdotL, NdotV, cosPhase, uLunarMix, uOppositionSurge);

      // Тень планеты (умбра): та же аналитическая модель, что у пыли и 2D-кольца
      // (ringDustPlanetShadow), поэтому граница тени совпадает между слоями. Гасит
      // ТОЛЬКО прямой свет звезды (диффуз + блик ниже); эмбиент остаётся → камень
      // в тени не проваливается в глухой ноль (floor 0.04, как у прочих слоёв).
      float planetShadow = ringDustPlanetShadow(vRingPos);

      // Planetshine: второй источник — планета рядом; ложится на альбедо с AO,
      // в умбре фаза сама уходит в ноль
      float shine = asteroidPlanetshine(normal, normalize(vPlanetDirView), vRingPos, uDustLightDirRing, uDustPlanetRadius);

      vec3 finalColor = albedo * (lightIntensity * surfAO * planetShadow + uSurfaceAmbient)
                      + albedo * uPlanetshineColor * (uPlanetshineStrength * shine * surfAO);

      // Blinn-Phong блик (металл/лёд), только на освещённой стороне, со спекуляр-AA.
      vec3 halfVec = normalize(lightDirection + viewDir);
      // Спекуляр-AA (B4): на дальних/мелких камнях нормаль сильно меняется в
      // пределах пикселя → узкий блик «фейерит». Разброс нормали оцениваем
      // экранными производными и по нему (Toksvig-подобно) расширяем блик:
      // снижаем эффективную жёсткость И силу, гася подпиксельные вспышки.
      // var→0 (близко/гладко): множитель 1, блик как есть.
      float specNormalVar = dot(dFdx(normal), dFdx(normal)) + dot(dFdy(normal), dFdy(normal));
      float specToksvig = 1.0 / (1.0 + specPower * specNormalVar);
      float specPowerAA = specPower * specToksvig;
      float spec = pow(max(dot(normal, halfVec), 0.0), specPowerAA) * specStrength * specToksvig;
      vec3 specColor = mix(vec3(1.0), albedo, uSpecularTint);
      // Гейт блика — сырой косинус к свету, а не LS-диффуз (тот к лимбу доходит до 2)
      finalColor += spec * specColor * max(NdotL, 0.0) * planetShadow;

      // Аэроперспектива: камни тонут в пылевой дымке с расстоянием
      finalColor = ringDustApplyFog(finalColor, vRingPos);

      gl_FragColor = vec4(finalColor, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
