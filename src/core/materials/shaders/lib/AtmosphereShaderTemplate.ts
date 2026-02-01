import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, Vector3 } from 'three'

export const AtmosphereShaderTemplate: ShaderProps = {
  uniforms: {
    targetRadius: new Uniform(0),
    atmosphereRadius: new Uniform(0),
    lightPosition: new Uniform(new Vector3()),
    scatterRGB: new Uniform(new Vector3()),
    densityFalloff: new Uniform(0)
  },
  vertexShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;

    varying vec3 vPosition;
    varying vec3 vLocalLightDirection;
    varying vec3 vLocalCameraPosition;
    varying vec3 vViewPosition;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      vec3 worldLightDirection = normalize(worldPosition.xyz - lightPosition);

      vPosition = position;
      vLocalLightDirection = (inverse(modelMatrix) * vec4(worldLightDirection, 0.0)).xyz;
      vLocalCameraPosition = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      vViewPosition = -mvPosition.xyz;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    #define SCATTER_POINT_COUNT 15
    #define OPTICAL_DEPTH_POINT_COUNT 15

    uniform float targetRadius;
    uniform float atmosphereRadius;
    uniform vec3 scatterRGB;
    uniform float densityFalloff;

    varying vec3 vPosition;
    varying vec3 vLocalLightDirection;
    varying vec3 vLocalCameraPosition;
    varying vec3 vViewPosition;

    vec3 origin = vec3(0.0);

    #include <atmosphereFunctions>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      #include <atmosphereFragment>

      gl_FragColor = clamp(atmosphereColor, 0.0, 0.99);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
