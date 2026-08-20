import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, Vector3 } from 'three'
import { STAR_CORE_INTENSITY, STAR_LIMB_COEFF } from '@/core/materials/shaders/lib/helpers'

export const StarShaderTemplate: ShaderProps = {
  uniforms: {
    spectralColor: new Uniform(new Color()),
    uColorCool: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    uCoreIntensity: new Uniform(STAR_CORE_INTENSITY),
    uLimbCoeff: new Uniform(new Vector3(...STAR_LIMB_COEFF)),
    time: new Uniform(0)
  },
  vertexShader: `
    varying vec3 vPositionW;
    varying vec3 vPosition;
    varying vec3 vCenterW;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      vPositionW = worldPosition.xyz;
      vPosition = position;
      vCenterW = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 spectralColor;
    uniform vec3 uColorCool;
    uniform vec3 uColorHot;
    uniform float uCoreIntensity;
    uniform vec3 uLimbCoeff;
    uniform float time;

    varying vec3 vPositionW;
    varying vec3 vPosition;
    varying vec3 vCenterW;

    #include <noiseFunctions>
    #include <starSurface>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      // Домен шума: |vPosition| = R, множитель 0.05 — масштаб ячеек;
      // тот же домен воспроизводит импостор (uRadius * 0.05)
      vec3 noiseDomain = vPosition * 0.05;

      // Зерно гаснет по экранному масштабу ячеек, а не по расстоянию до
      // камеры: мера общая с импостором (чанк starSurface), поэтому на
      // переключении LOD погасшая поверхность стыкуется сама собой. Побочно
      // домен сжат ракурсом у кромки — грануляция тускнеет к лимбу, как у Солнца
      float fade = starGranulationFade(starDomainPerPixel(noiseDomain));
      float t = starGranulationT(vec4(noiseDomain, time), fade);

      vec3 granule = starGranuleColor(t, uColorCool, spectralColor, uColorHot);
      float energy = starEnergy(t, uCoreIntensity);

      // Лимбовое потемнение: mu — косинус (нормаль сферы, луч на камеру)
      vec3 normalW = normalize(vPositionW - vCenterW);
      vec3 viewW = normalize(cameraPosition - vPositionW);
      float mu = clamp(dot(normalW, viewW), 0.0, 1.0);
      vec3 limb = starLimb(mu, uLimbCoeff);

      // Потолок HDR — тот же, что у атмосферы (half-float буфер, AgX-плечо);
      // при текущих дефолтах пик ~12 — потолок срабатывает только при uCoreIntensity ≈ 21+ (защитный предел)
      vec3 color = min(granule * energy * limb, vec3(64.0));

      gl_FragColor = vec4(color, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
