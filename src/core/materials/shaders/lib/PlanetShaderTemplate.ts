import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, UniformsUtils, Vector2, Vector3 } from 'three'
import { AppUniformsChunk } from './chunks'

const defaultUniforms = {
  lightPosition: new Uniform(new Vector3()),
  diffuseMap: new Uniform(null),
  nightMap: new Uniform(null),
  cloudMap: new Uniform(null),
  specularMap: new Uniform(null),
  bumpMap: new Uniform(null),
  bumpScale: new Uniform(0),
  uBumpTexelSize: new Uniform(new Vector2()),
  emission: new Uniform(1),
  uSpecularStrength: new Uniform(2.0),
  uRingShineStrength: new Uniform(1.0)
}
const ringShadowUniforms = AppUniformsChunk.ringShadowUniforms

export const PlanetShaderTemplate: ShaderProps = {
  uniforms: UniformsUtils.merge([defaultUniforms, ringShadowUniforms]),
  vertexShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vViewLightDirection;
    varying vec3 vLocalLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vEast;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      vec3 worldLightDirection = normalize(worldPosition.xyz - lightPosition);
      vec3 localLightDirection = (inverse(modelMatrix) * vec4(worldLightDirection, 0.0)).xyz;
      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);

      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vPosition = position;
      // Восток (касательная вдоль долготы) для TBN нормали из карты высот.
      // Не нормализуем: длина ∝ cos(широты) и служит детектором полюса,
      // где касательная вырождается.
      vEast = normalMatrix * cross(vec3(0.0, 1.0, 0.0), position);
      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vLocalLightDirection = localLightDirection;
      vViewPosition = -mvPosition.xyz;

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 lightPosition;
    uniform sampler2D diffuseMap;
    uniform sampler2D nightMap;
    uniform sampler2D cloudMap;
    uniform sampler2D specularMap;
    uniform sampler2D bumpMap;
    uniform float bumpScale;
    uniform float emission;
    uniform float uSpecularStrength;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vViewLightDirection;
    varying vec3 vLocalLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vEast;

    #ifdef USE_BUMP
      #include <heightNormalUniforms>
      #include <heightNormalFunctions>
    #endif

    #ifdef USE_RING
      #include <ringShadowUniforms>
      #include <ringShadowFunctions>
      #include <sphereShadowFunctions>
      #include <ringShineUniforms>
      #include <ringShineFunctions>
    #endif

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 normal = normalize(vNormal);

      #ifdef USE_BUMP
        normal = perturbNormalFromHeight(normal, vEast, vUv);
      #endif

      vec3 lightDirection = normalize(vViewLightDirection);
      float NdotLraw = dot(normal, lightDirection);
      float lightIntensity = max(NdotLraw, 0.0);

      vec3 dayColor = texture2D(diffuseMap, vUv).rgb;

      // Ночная и облачная карты есть не у всех тел. Раньше сэмплеры читались
      // безусловно, и корректность держалась на правиле GL «непривязанная
      // текстура читается чёрной». Гейты делают это явным.
      vec3 nightColor = vec3(0.0);
      #ifdef USE_NIGHT
        nightColor = texture2D(nightMap, vUv).rgb;
      #endif

      vec3 cloudColor = vec3(0.0);
      float cloudAlpha = 0.0;
      #ifdef USE_CLOUD
        cloudColor = texture2D(cloudMap, vUv).rgb;
        cloudColor *= pow(max(0.5 * lightIntensity + 0.1, 0.0), 0.5);
        cloudAlpha = dot(cloudColor, vec3(1.0)) / 3.0;
        cloudAlpha = pow(cloudAlpha, 0.5);
      #endif

      vec3 day = cloudColor + dayColor * (1.0 - cloudAlpha);
      vec3 night = nightColor * nightColor * emission;

      // Отсвет колец: единственный источник света на ночной стороне газовых
      // гигантов. Добавляется до ночного гейта (на дневной стороне тонет
      // в солнце) и до клампа 0.99 — не блумит, инвариант bloom-guard цел.
      #ifdef USE_RING
        night += getRingShine(normalize(vPosition), vPosition, normalize(vLocalLightDirection), length(vPosition));
      #endif

      // Терминатор: компактная smoothstep-зона вместо линейного mix по всей
      // полусфере; края зоны — ручки приёмки. Цвет НЕ подкрашивается:
      // покраснение заката — атрибут рассеяния в атмосфере (слой Брюнетона),
      // на поверхности и у безатмосферных тел оно нефизично.
      float dayFactor = smoothstep(-0.08, 0.25, NdotLraw);

      // Ночные огни только в темноте (раньше просвечивали на дневной стороне)
      float nightGate = 1.0 - smoothstep(-0.05, 0.12, NdotLraw);
      night *= nightGate;

      vec3 finalColor = mix(night, day, dayFactor);
      finalColor = clamp(finalColor, 0.0, 1.0);

      // Единый теневой множитель кольца: гасит и диффуз, и блик ниже
      vec3 ringShadowFactor = vec3(1.0);
      #ifdef USE_RING
        ringShadowFactor = getShadowFromRings(vec3(1.0), normalize(vLocalLightDirection));
      #endif
      finalColor *= ringShadowFactor;

      // Bloom-guard владельца: диффуз-композит планеты клампится НИЖЕ порога
      // bloom (0.99 < 1.0) — планета не блумит. Блик добавляется ПОСЛЕ.
      finalColor = clamp(finalColor, 0.0, 0.99);

      #ifdef USE_SPECULAR
        // Blinn-Phong + френель Шлика (F0 воды 0.02): дорожка следит за
        // камерой, вспыхивает на скользящих углах, гаснет у терминатора.
        // HDR-глинт поверх клампа — блумит только солнечная дорожка.
        vec3 viewDir = normalize(vViewPosition);
        vec3 halfVec = normalize(lightDirection + viewDir);
        float specComp = pow(max(dot(normal, halfVec), 0.0), 64.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
        float specularIntensity = texture2D(specularMap, vUv).r;
        finalColor += specularIntensity * specComp * fresnel * uSpecularStrength
                    * smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor;
      #endif

      // Потолок глинта: планета целиком остаётся далеко под half-float/AgX.
      // При текущих дефолтах пик ~3.0 — потолок рассчитан на подъём uSpecularStrength.
      gl_FragColor = vec4(min(finalColor, vec3(4.0)), 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
