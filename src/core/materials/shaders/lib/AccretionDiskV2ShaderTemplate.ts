import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform } from 'three'

export const AccretionDiskV2ShaderTemplate: ShaderProps = {
  uniforms: {
    diffuseMap: new Uniform(null),
    innerRadius: new Uniform(0),
    outerRadius: new Uniform(0)
  },
  vertexShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    varying vec2 vUv;
    varying vec3 vPosition;

    void main() {
      vec3 viewPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;

      gl_Position = projectionMatrix * vec4(viewPosition, 1.0);

      vUv = uv;
      vPosition = position;
    }
  `,
  fragmentShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform sampler2D diffuseMap;
    uniform float innerRadius;
    uniform float outerRadius;

    varying vec2 vUv;
    varying vec3 vPosition;

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

      gl_FragColor = color;

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
