import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'

export const RingShaderTemplate: ShaderProps = {
  uniforms: {
    diffuseMap: new Uniform(null),
    innerRadius: new Uniform(0),
    outerRadius: new Uniform(0),
    alphaTest: new Uniform(0),
    lightPosition: new Uniform(new Vector3()),
    planetRadius: new Uniform(0),
    minDistance: new Uniform(toThreeJSUnits(1000)),
    maxDistance: new Uniform(toThreeJSUnits(5000)),
    uRingForwardScattering: new Uniform(0),
    uRingOppositionSurge: new Uniform(0),
    uRingDensityExtinction: new Uniform(0)
  },
  vertexShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;

    varying vec3 vPosition;
    varying vec3 vLightDirectionL;
    varying vec3 vLocalCameraPosition;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vec3 viewPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;

      gl_Position = projectionMatrix * vec4(viewPosition, 1.0);

      vec3 lightDirWorld = normalize(worldPosition.xyz - lightPosition);
      vec3 lightDirLocal = (inverse(modelMatrix) * vec4(lightDirWorld, 0.0)).xyz;

      vPosition = position;
      vLightDirectionL = lightDirLocal;
      vLocalCameraPosition = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform sampler2D diffuseMap;
    uniform float innerRadius;
    uniform float outerRadius;
    uniform float alphaTest;
    uniform float planetRadius;
    uniform float minDistance;
    uniform float maxDistance;
    uniform float uRingForwardScattering;
    uniform float uRingOppositionSurge;
    uniform float uRingDensityExtinction;

    #define RING_OPPOSITION_G 0.3

    // Хеньи–Гринштейн в нормировке «изотропное рассеяние равно единице».
    // g < 0 даёт пик на просвет, g > 0 — со стороны звезды
    float ringPhase(float cosTheta, float g) {
      float g2 = g * g;
      return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    }

    varying vec3 vPosition;
    varying vec3 vLightDirectionL;
    varying vec3 vLocalCameraPosition;

    float getShadowFromSphere(vec3 lightDirLocal, vec3 ringPosLocal, float planetRadius) {
      vec3 sunDir = normalize(lightDirLocal);
      float pDotL = dot(ringPosLocal, sunDir);
      if (pDotL <= 0.0) return 1.0; // солнечная сторона — не в тени
      // Мягкая кромка полутени (~8% радиуса планеты) вместо жёсткого перехода:
      // perp — расстояние от точки до оси теневого цилиндра вдоль направления на солнце
      float perp = sqrt(max(dot(ringPosLocal, ringPosLocal) - pDotL * pDotL, 0.0));
      float penumbra = planetRadius * 0.08;
      float shade = smoothstep(planetRadius, planetRadius + penumbra, perp);
      return mix(0.04, 1.0, shade); // 0.04 в умбре → 1.0 вне тени
    }

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec2 uv;
      uv.x = (length(vPosition) - innerRadius) / (outerRadius - innerRadius);

      if (uv.x < 0.0 || uv.x > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
      }
      uv.y = 0.0;

      vec4 color = texture2D(diffuseMap, uv);

      if (color.a <= 0.0 || color.a <= alphaTest) discard;

      float distance = length(vLocalCameraPosition - vPosition);
      float transparencyFactor = smoothstep(minDistance, maxDistance, distance);

      color.a *= transparencyFactor;

      // Непрозрачность по углу взгляда: анфас (луч ⊥ плоскости кольца) — полная,
      // на ребро — гаснет, чтобы 2D-текстура не конкурировала с объёмной пылью.
      // faceCos = |cos| между лучом камера→фрагмент и нормалью кольца (лок. +Z).
      vec3 viewDirLocal = normalize(vLocalCameraPosition - vPosition);
      float faceCos = abs(viewDirLocal.z);
      const float ringEdgeOpacity = 0.1; // непрозрачность на ребре (тюнить визуально)
      const float ringAngleCurve = 1.5;  // круче → быстрее гаснет к ребру
      float angleOpacity = mix(ringEdgeOpacity, 1.0, pow(faceCos, ringAngleCurve));
      color.a *= angleOpacity;

      float shadow = getShadowFromSphere(vLightDirectionL, vPosition, planetRadius);

      // Одна формула на обе стороны: ветвление по стороне давало скачок
      // яркости при переходе камеры через плоскость кольца
      vec3 lightDir = normalize(vLightDirectionL);
      float cosTheta = dot(-lightDir, viewDirLocal);

      // Прошедший свет гаснет с оптической толщей, отражённый насыщается.
      // Вместе с покрытием (альфа-блендинг) это даёт максимум на средней
      // плотности: пустого места не видно, плотное не пропускает свет
      float tau = uRingDensityExtinction * color.a;
      float transmit = exp(-tau);
      float reflectance = 1.0 - transmit;

      float forward = ringPhase(cosTheta, -uRingForwardScattering);
      float back = ringPhase(cosTheta, RING_OPPOSITION_G);

      vec3 finalColor = color.rgb * (transmit * forward + reflectance * uRingOppositionSurge * back);

      gl_FragColor = vec4(finalColor * shadow, color.a);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
