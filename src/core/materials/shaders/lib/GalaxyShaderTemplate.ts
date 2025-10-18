import { ShaderProps } from '@/core/materials/shaders/AbstractShader.ts'
import { Uniform } from 'three'

export const GalaxyShaderTemplate: ShaderProps = {
  uniforms: {
    map: new Uniform(null),
    size: new Uniform(0.1)
  },
  vertexShader: `
    uniform float size;

    varying vec3 vColor;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      gl_PointSize = size * (300.0 / -mvPosition.z);

      gl_Position = projectionMatrix * mvPosition;

      vColor = color;
    }
  `,
  fragmentShader: `
    uniform sampler2D map;

    varying float vStrength;
    varying vec3 vColor;

    void main() {
      vec4 texColor = texture2D(map, gl_PointCoord);
      vec3 finalColor = vColor * texColor.rgb;

      gl_FragColor = vec4(finalColor, texColor.a);
    }
  `
}
