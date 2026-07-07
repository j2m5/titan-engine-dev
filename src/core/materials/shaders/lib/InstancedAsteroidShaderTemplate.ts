import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, Vector3, Color } from 'three'

export const InstancedAsteroidShaderTemplate: ShaderProps = {
  uniforms: {
    lightPosition: new Uniform(new Vector3()),
    // Процедурный облик — профиль (см. чанк AsteroidSurface / AsteroidProfiles)
    uRockColor: new Uniform(new Color(0x6b6157)),
    uColorJitter: new Uniform(0.12),
    uTintStrength: new Uniform(0.25),
    uMariaStrength: new Uniform(0.3),
    uGrainStrength: new Uniform(0.15),
    uGrainFreq: new Uniform(22.0),
    uCraterFreq: new Uniform(4.0),
    uCraterDensity: new Uniform(0.6),
    uCraterRadius: new Uniform(0.5),
    uCraterDepth: new Uniform(0.5),
    uCraterOctaves: new Uniform(1),
    uCrackWidth: new Uniform(0.05),
    uCrackIntensity: new Uniform(0.5),
    uCrackPatchiness: new Uniform(0.7),
    uAoStrength: new Uniform(0.6),
    uCraterNormalScale: new Uniform(1.0),
    uSurfaceAmbient: new Uniform(0.03),
    uSpecularStrength: new Uniform(0.05),
    uSpecularPower: new Uniform(8.0),
    uSpecularTint: new Uniform(0.0),
    // Дальность детализации (fwidth-AA): деталь гаснет между Start и End
    // (циклов зерна на пиксель). Больше → деталь держится дальше.
    uAaStart: new Uniform(1.2),
    uAaEnd: new Uniform(3.0),
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
    // Радиальный профиль пыли из альфы текстуры кольца; scale 0 — выключен
    uDustRadialMap: new Uniform(null),
    uDustRadialMapScale: new Uniform(0),
    // Деформация силуэта (см. чанк AsteroidShape). Амплитуда — per-instance из
    // диапазона [min,max]; min=max=0 → форма выключена.
    uShapeAmpMin: new Uniform(0),
    uShapeAmpMax: new Uniform(0),
    uShapeFreq: new Uniform(1)
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

    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vRingPos;
    varying vec3 vObjectPos;
    varying float vInstanceSeed;
    varying vec3 vObjectNormal;
    varying mat3 vObjToView;
    varying float vFade;

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

      // Для процедурного облика (см. чанк AsteroidSurface): объектная позиция
      // (домен) и per-instance сид (тип/тинт) — переиспользуем сид формы. Нормаль
      // считается АНАЛИТИЧЕСКИ во фрагменте в объектном пространстве, поэтому
      // прокидываем геом. нормаль объекта и матрицу объект→view.
      vObjectPos = shapedPos;
      vInstanceSeed = shapeSeed;
      vObjectNormal = shapedNormal;
      vObjToView = normalMatrix * instanceNormalMatrix;
      vFade = instanceFade;

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
    uniform float uGrainStrength;
    uniform float uGrainFreq;
    uniform float uCraterFreq;
    uniform float uCraterDensity;
    uniform float uCraterRadius;
    uniform float uCraterDepth;
    uniform float uCraterOctaves;
    uniform float uCrackWidth;
    uniform float uCrackIntensity;
    uniform float uCrackPatchiness;
    uniform float uAoStrength;
    uniform float uCraterNormalScale;
    uniform float uSurfaceAmbient;
    uniform float uSpecularStrength;
    uniform float uSpecularPower;
    uniform float uSpecularTint;
    uniform float uAaStart;
    uniform float uAaEnd;

    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vRingPos;
    varying vec3 vObjectPos;
    varying float vInstanceSeed;
    varying vec3 vObjectNormal;
    varying mat3 vObjToView;
    varying float vFade;

    #include <noiseFunctions>
    #include <asteroidSurfaceFunctions>
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

      // Процедурный облик: альбедо + АНАЛИТИЧЕСКИ возмущённая объектная нормаль +
      // каверн-AO. Нормаль из аналитических градиентов (без dFdx-статики).
      vec3 perturbedObjNormal;
      float surfAO;
      vec3 baseSurfAlbedo;
      vec3 albedo = applyAsteroidSurface(
        surfDir, normalize(vObjectNormal), vInstanceSeed,
        uRockColor, uColorJitter, uTintStrength, uMariaStrength,
        uGrainStrength, uGrainFreq, uCraterNormalScale,
        uCraterFreq, uCraterDensity, uCraterRadius, uCraterDepth, uCraterOctaves,
        uCrackWidth, uCrackIntensity, uCrackPatchiness,
        uAoStrength,
        perturbedObjNormal, surfAO, baseSurfAlbedo
      );

      // fwidth-AA нормали: где зерно подпиксельно — сводим возмущение к геом.
      // нормали, гася аляйсинг сигнала. Частота — зерна (самая ВЧ в нормали).
      float cyclesPerPixel = length(fwidth(surfDir)) * uGrainFreq;
      float aaFade = 1.0 - smoothstep(uAaStart, uAaEnd, cyclesPerPixel);
      vec3 objN = normalize(mix(normalize(vObjectNormal), perturbedObjNormal, aaFade));

      // fwidth-AA альбедо (B0): тёмные линии трещин и пятна кратеров — это АЛЬБЕДО,
      // у него нет сглаживания нормали → на среднем плане мельтешит. Гасим деталь
      // альбедо и AO к базовому (НЧ maria/мотл) по частоте КРАТЕРНОГО узора: он
      // грубее зерна, поэтому альбедо держится дольше и не смазывается раньше срока.
      float albedoCyclesPerPixel = length(fwidth(surfDir)) * uCraterFreq;
      float albedoFade = 1.0 - smoothstep(uAaStart, uAaEnd, albedoCyclesPerPixel);
      albedo = mix(baseSurfAlbedo, albedo, albedoFade);
      surfAO = mix(1.0, surfAO, albedoFade);

      // Объектная нормаль → view; учёт ориентации грани
      vec3 normal = normalize(vObjToView * objN);
      if (!gl_FrontFacing) normal = -normal;

      vec3 lightDirection = normalize(vViewLightDirection);
      float lightIntensity = max(dot(normal, lightDirection), 0.0);

      // Тень планеты (умбра): та же аналитическая модель, что у пыли и 2D-кольца
      // (ringDustPlanetShadow), поэтому граница тени совпадает между слоями. Гасит
      // ТОЛЬКО прямой свет звезды (диффуз + блик ниже); эмбиент остаётся → камень
      // в тени не проваливается в глухой ноль (floor 0.04, как у прочих слоёв).
      float planetShadow = ringDustPlanetShadow(vRingPos);

      vec3 finalColor = albedo * (lightIntensity * surfAO * planetShadow + uSurfaceAmbient);

      // Blinn-Phong блик (металл/лёд), только на освещённой стороне, со спекуляр-AA.
      vec3 viewDir = normalize(vViewPosition);
      vec3 halfVec = normalize(lightDirection + viewDir);
      // Спекуляр-AA (B4): на дальних/мелких камнях нормаль сильно меняется в
      // пределах пикселя → узкий блик «фейерит». Разброс нормали оцениваем
      // экранными производными и по нему (Toksvig-подобно) расширяем блик:
      // снижаем эффективную жёсткость И силу, гася подпиксельные вспышки.
      // var→0 (близко/гладко): множитель 1, блик как есть.
      float specNormalVar = dot(dFdx(normal), dFdx(normal)) + dot(dFdy(normal), dFdy(normal));
      float specToksvig = 1.0 / (1.0 + uSpecularPower * specNormalVar);
      float specPowerAA = uSpecularPower * specToksvig;
      float spec = pow(max(dot(normal, halfVec), 0.0), specPowerAA) * uSpecularStrength * specToksvig;
      vec3 specColor = mix(vec3(1.0), albedo, uSpecularTint);
      finalColor += spec * specColor * lightIntensity * planetShadow;

      // Аэроперспектива: камни тонут в пылевой дымке с расстоянием
      finalColor = ringDustApplyFog(finalColor, vRingPos);

      gl_FragColor = vec4(finalColor, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
