/**
 * BrunetonAtmosphereShaderTemplate.ts
 *
 * Adaptation of Eric Bruneton's Precomputed Atmospheric Scattering (2017)
 * for use with Three.js RawShaderMaterial on spherical atmosphere meshes.
 *
 * This version uses PARAMETRIC atmosphere parameters (via uniforms)
 * instead of hardcoded Earth values. Works with any planet whose LUTs
 * have been precomputed via AtmosphereLUTGenerator.
 *
 * No built-in tone mapping — assumed to be handled by post-processing.
 * No #version 300 es — Three.js injects it via glslVersion: GLSL3.
 *
 * МАТРИЦЫ: встроенные имена three.js (modelViewMatrix / projectionMatrix) —
 * это осознанный контракт. Рендерер безусловно заливает их для каждого
 * объекта в конце setProgram (даже для RawShaderMaterial), поэтому свои
 * значения под этими именами до GPU не доходят. Точность здесь несут
 * localCameraPos / localSunDir (float64 на CPU). Контрпример — BlackHole:
 * там шейдер реконструирует лучи из матриц, поэтому используются
 * собственные cr*-имена, которые рендерер не перезаписывает.
 */

import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Uniform, Vector2, Vector3 } from 'three'
import { createParametricAtmosphereShader } from './atmosphereParametric'

const parametricAtmosphere = createParametricAtmosphereShader()

// Дефолт (земной, радианы) — перезаписывается из конфига в конструкторе материала
const SUN_ANGULAR_RADIUS = 0.004675

export const BrunetonAtmosphereShaderTemplate: ShaderProps = {
  uniforms: {
    localCameraPos: new Uniform(new Vector3()),
    localSunDir: new Uniform(new Vector3()),
    inverseSpaceScale: new Uniform(1.0 / Math.pow(10, -3.3)),
    exposure: new Uniform(10.0),
    white_point: new Uniform(new Vector3(1.0, 1.0, 1.0)),
    uHdrKnee: new Uniform(1.0),
    uLegacyComposition: new Uniform(0),
    uDebugView: new Uniform(0),
    sun_size: new Uniform(new Vector2(Math.tan(SUN_ANGULAR_RADIUS), Math.cos(SUN_ANGULAR_RADIUS))),
    transmittance_texture: new Uniform(null),
    scattering_texture: new Uniform(null),
    irradiance_texture: new Uniform(null),
    single_mie_scattering_texture: new Uniform(null),
    logDepthBufFC: new Uniform(0)
  },
  vertexShader: /* glsl */ `
    precision highp float;

    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;

    uniform vec3 localCameraPos;
    uniform vec3 localSunDir;

    uniform float inverseSpaceScale;

    in vec3 position;

    out vec3 vPositionKm;
    out vec3 vCameraPositionKm;
    out vec3 vSunDirection;
    out float vFragDepth;
    out float vIsPerspective;

    bool isPerspectiveMatrix(mat4 m) {
      return m[2][3] == -1.0;
    }

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      // Everything precomputed on CPU — no inverse(), no large numbers
      vPositionKm = position * inverseSpaceScale;
      vCameraPositionKm = localCameraPos * inverseSpaceScale;
      vSunDirection = localSunDir;

      vFragDepth = 1.0 + gl_Position.w;
      vIsPerspective = float(isPerspectiveMatrix(projectionMatrix));
    }
  `,
  fragmentShader: /* glsl */ `
    ${parametricAtmosphere}

    uniform float exposure;
    uniform vec3 white_point;
    uniform float uHdrKnee;
    uniform float uLegacyComposition; // 0 — покомпонентная композиция, 1 — старая скалярная
    uniform float uDebugView; // 0 off, 1 in-scatter, 2 transmittance, 3 alpha
    uniform vec2 sun_size;
    uniform float logDepthBufFC;

    in vec3 vPositionKm;
    in vec3 vCameraPositionKm;
    in vec3 vSunDirection;
    in float vFragDepth;
    in float vIsPerspective;

    layout(location = 0) out vec4 fragColor;

    void main() {
      // DoubleSide: снаружи атмосферы обе полусферы дают одинаковый силуэт и цвет,
      // поэтому задняя грань — лишний второй проход блендинга. Изнутри (r < topRadius)
      // видимы только задние грани — их оставляем, иначе атмосфера пропадёт.
      // Запас 2%: у самой границы передняя грань уходит под near-clip раньше,
      // чем камера пересечёт topRadius — в этой полосе рендерим обе грани.
      if (!gl_FrontFacing && length(vCameraPositionKm) > u_top_radius * 1.02) discard;

      vec3 camera = vCameraPositionKm;
      vec3 viewDirection = normalize(vPositionKm - camera);
      vec3 sunDir = normalize(vSunDirection);

      // Use parametric bottom_radius from uniforms (not hardcoded 6360)
      float bottomR = u_bottom_radius;
      float topR = u_top_radius;

      float r = length(camera);

      // Clamp camera radius to valid atmosphere bounds
      float rClamped = max(r, bottomR + 0.01);

      vec3 cameraClamped = camera;
      if (r > 0.001) {
        cameraClamped = camera * (rClamped / r);
      } else {
        cameraClamped = vec3(0.0, rClamped, 0.0);
      }

      float rFinal = length(cameraClamped);
      float mu = dot(normalize(cameraClamped), viewDirection);

      // Compute atmosphere scattering using wrapper functions from atmosphere.js
      // (which now use buildAtmosphere() via #define ATMOSPHERE)
      vec3 transmittance;
      vec3 radiance;

      bool hitsGround = RayIntersectsGround(ATMOSPHERE, rFinal, mu);

      if (hitsGround) {
        float groundDist = DistanceToBottomAtmosphereBoundary(ATMOSPHERE, rFinal, mu);
        vec3 groundPoint = cameraClamped + viewDirection * groundDist;

        radiance = GetSkyRadianceToPoint(
          cameraClamped, groundPoint, 0.0, sunDir, transmittance);
      } else {
        radiance = GetSkyRadiance(
          cameraClamped, viewDirection, 0.0, sunDir, transmittance);

        if (dot(viewDirection, sunDir) > sun_size.y) {
          radiance += transmittance * GetSolarRadiance();
        }
      }

      // Дебаг-виды слагаемых (спека 2026-07-31): сырые значения до колена
      // и потолка — диагностика вуали без искажений. Непрозрачный вывод,
      // чтобы поверхность под атмосферой не подмешивалась.
      if (uDebugView > 0.5) {
        vec3 dbg = uDebugView < 1.5 ? radiance / white_point * exposure
                 : uDebugView < 2.5 ? transmittance
                 : vec3(1.0 - dot(transmittance, vec3(1.0 / 3.0)));
        fragColor = vec4(dbg, 1.0);
        gl_FragDepth = vIsPerspective == 0.0
          ? gl_FragCoord.z
          : log2(vFragDepth) * logDepthBufFC * 0.5;
        return;
      }

      // Линейный HDR-выход: плечо делает ОБЩИЙ тонмап постобработки (AgX,
      // Postprocessing.ts) — одна кривая на всю сцену, без двойного сжатия.
      // Для полутонов совпадает со старой кривой (1-e^-x ≈ x), поэтому
      // exposure сохраняет смысл линейного калибровочного множителя.
      vec3 color = radiance / white_point * exposure;

      // Колено HDR-избытка: ниже 1.0 в линейном выходе картинка не меняется
      // (экранный порог после альфа-бленда — 1/alpha), сжимается только то,
      // что уходит в свечение. 1.0 = нейтрально;
      // пер-планетная ручка hdrKnee в data (Венера гасится сильнее всех).
      vec3 excess = max(color - vec3(1.0), vec3(0.0));
      color = min(color, vec3(1.0)) + excess * uHdrKnee;

      // Потолок HDR: half-float буфер переполняется на 65504, диск солнца
      // через GetSolarRadiance даёт 1e4..1e8 — без потолка Inf/NaN в бленде.
      color = min(color, vec3(64.0));

      // Композиция вынесена в два прохода блендинга (спека 2026-08-01):
      // проход A множит кадр на пропускание (Zero/SrcColor), проход B
      // добавляет in-scatter (One/One). Пер-канальное пропускание в одном
      // RGBA-выходе не помещается: RGB заняты in-scatter, а альфа — скаляр,
      // отсюда и было схлопывание цвета в серое.
      //
      // uLegacyComposition = 1 воспроизводит прежний NormalBlending
      // (dst·meanT + color·alpha) для живого сравнения при приёмке.
      float meanT = dot(transmittance, vec3(1.0 / 3.0));
      float alpha = clamp(1.0 - meanT, 0.0, 1.0);

      #ifdef ATMOSPHERE_PASS_TRANSMITTANCE
        vec3 outTransmittance = mix(transmittance, vec3(meanT), uLegacyComposition);
        fragColor = vec4(outTransmittance, 1.0);
      #else
        vec3 outScatter = color * mix(1.0, alpha, uLegacyComposition);
        fragColor = vec4(outScatter, 1.0);
      #endif

      gl_FragDepth = vIsPerspective == 0.0
        ? gl_FragCoord.z
        : log2(vFragDepth) * logDepthBufFC * 0.5;
    }
  `
}
