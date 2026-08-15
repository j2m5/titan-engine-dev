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
  uNightThreshold: new Uniform(0.06),
  uNightSoftness: new Uniform(0.18)
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
    varying vec3 vLocalDir;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      vec3 worldLightDirection = normalize(worldPosition.xyz - lightPosition);
      vec3 localLightDirection = (inverse(modelMatrix) * vec4(worldLightDirection, 0.0)).xyz;
      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);

      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      // У патчей кубосферы position — смещение от ЦЕНТРА ПАТЧА (RTC), не от
      // центра тела; USE_RING (RingShadow) сегодня безвредно её использует
      // только для тел без колец-детей — терраформное тело с кольцом даст
      // неверную тень (чинить при первом таком теле).
      vPosition = position;
      // Восток (касательная вдоль долготы) для TBN нормали из карты высот.
      // Строим из НОРМАЛИ, не из position: normal радиальна на обоих путях
      // (SphereGeometry и RTC-патчи кубосферы), а position патча — нет, и
      // cross(up, position) вращался бы вокруг центра патча, а не тела.
      // Не нормализуем: длина ∝ cos(широты) и служит детектором полюса, где
      // касательная вырождается — |vEast| = cos(lat) вместо R·cos(lat)
      // старого пути, гард len < 1e-4 срабатывает у полюса на ~0.006°
      // вместо ~0.002° (пренебрежимо у обоих).
      vEast = normalMatrix * cross(vec3(0.0, 1.0, 0.0), normal);
      // Body-локальное радиальное направление для попиксельного UV терраформных
      // тел (USE_TERRAIN_UV) — без матриц: normal уже радиальна и body-локальна
      // на обоих путях (SphereGeometry и RTC-патчи кубосферы, см. vEast выше).
      vLocalDir = normal;
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
    uniform float uNightThreshold;
    uniform float uNightSoftness;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vViewLightDirection;
    varying vec3 vLocalLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vEast;
    varying vec3 vLocalDir;

    #ifdef USE_BUMP
      #include <heightNormalUniforms>
      #include <heightNormalFunctions>
    #endif

    #ifdef USE_SLOPE
      #include <slopeNormalFunctions>
    #endif

    #ifdef USE_RING
      #include <ringShadowUniforms>
      #include <ringShadowFunctions>
    #endif

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 normal = normalize(vNormal);

      #ifdef USE_TERRAIN_UV
        // UV из направления, попиксельно: вершинная развёртка равнопрямоугольной
        // текстуры на кубосфере вырождается у полюсов (один квад тянул 2048
        // текселей). Конвенция — та же, что dirToUv (CPU-канон): phi = atan(z, −x),
        // u = phi/2π (+1 при отрицательном — скачок производной совпадает со швом
        // текстуры: мип-линия там же и так же субпиксельна, как у старого
        // bump-пути), v = acos(y)/π.
        vec3 dirLocal = normalize(vLocalDir);
        float phi = atan(dirLocal.z, -dirLocal.x);
        float u = phi / 6.28318530717958647692;
        if (u < 0.0) u += 1.0;
        vec2 uv = vec2(u, acos(clamp(dirLocal.y, -1.0, 1.0)) / 3.14159265358979323846);
      #else
        vec2 uv = vUv;
      #endif

      #ifdef USE_BUMP
        normal = perturbNormalFromHeight(normal, vEast, uv);
      #endif

      #ifdef USE_SLOPE
        normal = perturbNormalFromSlope(normal, vEast, uv);
      #endif

      vec3 lightDirection = normalize(vViewLightDirection);
      float NdotLraw = dot(normal, lightDirection);
      float lightIntensity = max(NdotLraw, 0.0);

      vec3 dayColor = texture2D(diffuseMap, uv).rgb;

      // Ночная и облачная карты есть не у всех тел. Раньше сэмплеры читались
      // безусловно, и корректность держалась на правиле GL «непривязанная
      // текстура читается чёрной». Гейты делают это явным.
      vec3 nightColor = vec3(0.0);
      #ifdef USE_NIGHT
        nightColor = texture2D(nightMap, uv).rgb;
      #endif

      vec3 cloudColor = vec3(0.0);
      float cloudAlpha = 0.0;
      #ifdef USE_CLOUD
        cloudColor = texture2D(cloudMap, uv).rgb;
        cloudColor *= pow(max(0.5 * lightIntensity + 0.1, 0.0), 0.5);
        cloudAlpha = dot(cloudColor, vec3(1.0)) / 3.0;
        cloudAlpha = pow(cloudAlpha, 0.5);
      #endif

      vec3 day = cloudColor + dayColor * (1.0 - cloudAlpha);
      // Огни городов: порог с мягкостью вместо квадрата. Квадрат душил
      // середину и оставлял размытый ореол вокруг агломераций; порог гасит
      // слабую засветку и сохраняет яркие ядра. Тинт по яркости: тусклые
      // окраины натриево-оранжевые, яркие центры белее. Всё под клампом 0.99 —
      // огни не блумят.
      float nightLum = dot(nightColor, vec3(0.2126, 0.7152, 0.0722));
      float nightMask = smoothstep(uNightThreshold, uNightThreshold + uNightSoftness, nightLum);
      vec3 nightTint = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.97, 0.92), smoothstep(0.15, 0.6, nightLum));
      vec3 night = nightColor * nightTint * nightMask * emission;

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
        float specularIntensity = texture2D(specularMap, uv).r;
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
