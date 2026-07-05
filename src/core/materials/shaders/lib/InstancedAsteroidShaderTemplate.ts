import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, Vector3, Color } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'

export const InstancedAsteroidShaderTemplate: ShaderProps = {
  uniforms: {
    lightPosition: new Uniform(new Vector3()),
    bumpMap: new Uniform(null),
    bumpScale: new Uniform(0),
    // Процедурный облик (см. чанк AsteroidSurface)
    uRockColorC: new Uniform(new Color(0x2e2a26)),
    uRockColorS: new Uniform(new Color(0x6b6157)),
    uRockColorM: new Uniform(new Color(0x7a756e)),
    uRockTypeT1: new Uniform(0.55),
    uRockTypeT2: new Uniform(0.9),
    uTintStrength: new Uniform(0.25),
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
    minDistance: new Uniform(toThreeJSUnits(100)),
    maxDistance: new Uniform(toThreeJSUnits(5000)),
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

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vRingPos;
    varying vec3 vObjectPos;
    varying float vInstanceSeed;

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

      // Ring-local позиция фрагмента для модели пыли
      vRingPos = worldPosition.xyz;

      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);
      mat3 instanceNormalMatrix = mat3(instanceMatrix);
      vec3 transformedNormal = normalize(instanceNormalMatrix * shapedNormal);

      vUv = uv;
      vNormal = normalize(normalMatrix * transformedNormal);
      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vViewPosition = -mvPosition.xyz;

      // Для процедурного облика (см. чанк AsteroidSurface): объектная позиция
      // (домен) и per-instance сид (тип/тинт) — переиспользуем сид формы.
      vObjectPos = shapedPos;
      vInstanceSeed = shapeSeed;

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 lightPosition;
    uniform sampler2D bumpMap;
    uniform float bumpScale;
    uniform float minDistance;
    uniform float maxDistance;

    uniform vec3 uRockColorC;
    uniform vec3 uRockColorS;
    uniform vec3 uRockColorM;
    uniform float uRockTypeT1;
    uniform float uRockTypeT2;
    uniform float uTintStrength;
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

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vRingPos;
    varying vec3 vObjectPos;
    varying float vInstanceSeed;

    #include <bumpFunctions>
    #include <noiseFunctions>
    #include <asteroidSurfaceFunctions>
    #include <ringDustUniforms>
    #include <ringDustFunctions>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 normal = normalize(vNormal);
      float faceDirection = gl_FrontFacing ? 1.0 : -1.0;

      // Микрозерно от bumpMap (высокая частота)
      normal = perturbNormalArb(-vViewPosition, normal, dHdxy_fwd(), faceDirection);

      // Процедурный облик: альбедо + высота рельефа (для нормали) + каверн-AO
      float surfH;
      float surfAO;
      vec3 albedo = applyAsteroidSurface(
        normalize(vObjectPos), vInstanceSeed,
        uRockColorC, uRockColorS, uRockColorM, uRockTypeT1, uRockTypeT2, uTintStrength,
        uCraterFreq, uCraterDensity, uCraterRadius, uCraterDepth, uCraterOctaves,
        uCrackWidth, uCrackIntensity, uCrackPatchiness,
        uAoStrength,
        surfH, surfAO
      );

      // Мезо/макро-рельеф (кратеры/трещины) → нормаль через экранные производные
      vec2 dHdxyProc = vec2(dFdx(surfH), dFdy(surfH)) * uCraterNormalScale;
      normal = perturbNormalArb(-vViewPosition, normal, dHdxyProc, faceDirection);

      vec3 lightDirection = normalize(vViewLightDirection);
      float lightIntensity = max(dot(normal, lightDirection), 0.0);

      vec3 finalColor = albedo * (lightIntensity * surfAO + uSurfaceAmbient);

      // Аэроперспектива: камни тонут в пылевой дымке с расстоянием
      finalColor = ringDustApplyFog(finalColor, vRingPos);

      gl_FragColor = vec4(finalColor, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
