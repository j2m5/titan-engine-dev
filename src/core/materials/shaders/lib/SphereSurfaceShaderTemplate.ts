import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, UniformsUtils } from 'three'
import { AppUniformsChunk } from './chunks'
import { WATER_FAR_ALPHA2 } from './chunks/waterOctavesMath'
import {
  planetSurfaceComposite,
  planetSurfaceDefaultUniforms,
  planetSurfaceDirectGain,
  planetSurfaceDirectLight,
  planetSurfaceFragmentFunctions,
  planetSurfaceFragmentOutput,
  planetSurfaceFragmentPars,
  planetSurfaceFragmentPrologue,
  planetSurfaceLightBegin,
  planetSurfaceRingShadowPars,
  planetSurfaceVaryings,
  planetSurfaceVertexLight,
  planetSurfaceVertexOutputs,
  planetSurfaceVertexPars
} from './chunks/PlanetSurfaceCommon'

const sphereUniforms = {
  specularMap: new Uniform(null),
  // Блик воды на сфере — тот же закон, что у водной оболочки (waterGlintFunctions):
  // α² при всех погасших октавах и множитель; значения ставит шейдер по данным тела
  uWaterFarAlpha2: new Uniform(WATER_FAR_ALPHA2),
  uWaterGlintGain: new Uniform(1)
}

/**
 * Поверхность на SphereGeometry: гиганты и твёрдые тела, пока карта высот не
 * загружена. Диффуз по вершинному vUv, деталь облаков гиганта, блик воды.
 */
export const SphereSurfaceShaderTemplate: ShaderProps = {
  uniforms: UniformsUtils.merge([planetSurfaceDefaultUniforms, sphereUniforms, AppUniformsChunk.ringShadowUniforms]),
  vertexShader: `
    ${planetSurfaceVertexPars}

    // Вершинная развёртка — только у сферы: рельеф считает uv из направления
    varying vec2 vUv;

    void main() {
      vec3 morphedPosition = position;

      ${planetSurfaceVertexLight}

      // Радиальное направление вершины в системе тела — готовый атрибут normal сферы
      vec3 vertexDir = normal;
      vUv = uv;

      ${planetSurfaceVertexOutputs}

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${planetSurfaceFragmentPars}

    // Маска «океан/суша» блика воды (USE_SPECULAR)
    uniform sampler2D specularMap;

    #ifdef USE_GIANT_DETAIL
      #include <giantDetailUniforms>
    #endif

    ${planetSurfaceVaryings}
    varying vec2 vUv;

    // Развёртка из направления — точка облачного слоя не вершина, vUv ей не годится
    #ifdef USE_CLOUD
      #include <terrainUvFunctions>
    #endif

    ${planetSurfaceFragmentFunctions}

    ${planetSurfaceRingShadowPars}

    // Деталь облаков гиганта: чанку нужен snoise(vec3) — шум только под этим гейтом
    #ifdef USE_GIANT_DETAIL
      #include <noiseFunctions>
      #include <giantDetailFunctions>
    #endif

    #ifdef USE_SPECULAR
      // Блик воды на сфере: тот же лепесток и та же дальняя шероховатость, что у
      // водной оболочки, под облаками гаснет и тонируется солнцем, как у неё;
      // терминаторный гейт чуть иной (smoothstep по N·L против dayFactor воды)
      uniform float uWaterFarAlpha2;
      uniform float uWaterGlintGain;
      #include <waterGlintFunctions>
    #endif

    void main() {
      ${planetSurfaceFragmentPrologue}

      vec2 uv = vUv;

      vec3 diffuseSample = texture2D(diffuseMap, uv).rgb;

      #ifdef USE_GIANT_DETAIL
        // Деталь облаков гиганта под текселем — множитель альбедо
        applyGiantDetail(albedoMul, normalize(vPosition), uv, dot(diffuseSample, vec3(0.2126, 0.7152, 0.0722)), length(vViewPosition));
      #endif

      ${planetSurfaceLightBegin}

      ${planetSurfaceDirectGain}

      ${planetSurfaceDirectLight}

      ${planetSurfaceComposite}

      #ifdef USE_SPECULAR
        // Дорожка океана с орбиты: широкий лепесток по шероховатости погасших
        // октав, маска — specular-карта; гаснет у терминатора, в тени кольца и под
        // облаками, тонируется закатным солнцем (как у водной оболочки).
        float specularIntensity = texture2D(specularMap, uv).r;
        finalColor += specularIntensity * waterGlintGlsl(normal, lightDirection, viewDir, uWaterFarAlpha2) * uWaterGlintGain
                    * (1.0 - cloudAlphaSlant) * sunTintMix
                    * smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor * terrainShadow * eclipse;
      #endif

      ${planetSurfaceFragmentOutput}
    }
  `
}
