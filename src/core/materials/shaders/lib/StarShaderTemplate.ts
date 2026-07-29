import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, Vector3 } from 'three'

export const StarShaderTemplate: ShaderProps = {
  uniforms: {
    spectralColor: new Uniform(new Color()),
    uColorCool: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    uCoreIntensity: new Uniform(4.0),
    uLimbCoeff: new Uniform(new Vector3(0.5, 0.65, 0.8)),
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

    float fbm(vec4 pos, int octaves, float persistence) {
      float total = 0.0;
      float frequency = 1.0;
      float amplitude = 1.0;
      float maxValue = 0.0;

      for(int i = 0; i < octaves; i++) {
        total += snoise(pos * frequency) * amplitude;

        maxValue += amplitude;

        amplitude *= persistence;
        frequency *= 2.0;
      }

      return total / maxValue;
    }

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      // Грануляция: t в [0..1] — «температура ячейки» (0 холодная, 1 горячая)
      vec4 noisePos = vec4(vPosition * 0.05, time);
      float t = clamp(0.5 + (fbm(noisePos, 6, 0.9) - 0.5) * 2.0, 0.0, 1.0);

      // Чёрнотельная палитра: cool (T-400K) -> spectralColor (T) -> hot (T+400K)
      vec3 granule = t < 0.5
        ? mix(uColorCool, spectralColor, t * 2.0)
        : mix(spectralColor, uColorHot, t * 2.0 - 1.0);

      // Горячие ячейки ярче холодных; uCoreIntensity — базовая HDR-яркость диска
      float energy = mix(0.55, 3.0, t) * uCoreIntensity;

      // Лимбовое потемнение: mu — косинус (нормаль сферы, луч на камеру);
      // коэффициент в синем выше -> кромка диска теплеет, как у Солнца
      vec3 normalW = normalize(vPositionW - vCenterW);
      vec3 viewW = normalize(cameraPosition - vPositionW);
      float mu = clamp(dot(normalW, viewW), 0.0, 1.0);
      vec3 limb = clamp(vec3(1.0) - uLimbCoeff * (1.0 - mu), 0.0, 1.0);

      // Потолок HDR — тот же, что у атмосферы (half-float буфер, AgX-плечо)
      vec3 color = min(granule * energy * limb, vec3(64.0));

      gl_FragColor = vec4(color, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
