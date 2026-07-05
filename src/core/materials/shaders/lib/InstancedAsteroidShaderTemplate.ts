import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, Vector3, Color } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'

export const InstancedAsteroidShaderTemplate: ShaderProps = {
  uniforms: {
    lightPosition: new Uniform(new Vector3()),
    diffuseMap: new Uniform(null),
    bumpMap: new Uniform(null),
    nightMap: new Uniform(null),
    bumpScale: new Uniform(0),
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
    // Деформация силуэта (см. чанк AsteroidShape). Амплитуда 0 → форма выключена.
    uShapeAmp: new Uniform(0),
    uShapeFreq: new Uniform(1)
  },
  vertexShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;
    uniform float uShapeAmp;
    uniform float uShapeFreq;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vRingPos;

    #include <noiseFunctions>
    #include <asteroidShapeFunctions>

    void main() {
      // Деформация силуэта: сид формы — хеш от позиции инстанса (стабилен per-камень)
      float shapeSeed = hash13(instanceMatrix[3].xyz);
      vec3 shapedPos;
      vec3 shapedNormal;
      deformAsteroid(position, normal, shapeSeed, shapedPos, shapedNormal);

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

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 lightPosition;
    uniform sampler2D diffuseMap;
    uniform sampler2D bumpMap;
    uniform sampler2D nightMap;
    uniform float bumpScale;
    uniform float minDistance;
    uniform float maxDistance;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vRingPos;

    #include <bumpFunctions>
    #include <ringDustUniforms>
    #include <ringDustFunctions>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 normal = normalize(vNormal);

      float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
      normal = perturbNormalArb(-vViewPosition, normal, dHdxy_fwd(), faceDirection);

      vec3 lightDirection = normalize(vViewLightDirection);
      float lightIntensity = max(dot(normal, lightDirection), 0.0);

      vec3 dayColor = texture2D(diffuseMap, vUv).rgb;
      vec3 nightColor = texture2D(nightMap, vUv).rgb;

      vec3 day = dayColor;
      vec3 night = nightColor * nightColor;

      float dist = length(vViewPosition);
      float fade = 1.0 - smoothstep(minDistance, maxDistance, dist);

      //if (fade <= 0.0) discard;

      vec3 finalColor = mix(night, day, lightIntensity);

      // Аэроперспектива: камни тонут в пылевой дымке с расстоянием
      finalColor = ringDustApplyFog(finalColor, vRingPos);

      gl_FragColor = vec4(finalColor, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
