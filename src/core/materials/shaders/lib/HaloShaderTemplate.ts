import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, Vector3 } from 'three'

export const HaloShaderTemplate: ShaderProps = {
  uniforms: {
    lightDirection: new Uniform(new Vector3()),
    dayColor: new Uniform(new Color()),
    nightColor: new Uniform(new Color())
  },
  vertexShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;

    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vLocalLightDirection;
    varying vec3 vLocalCameraPosition;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      vec3 worldLightDirection = normalize(worldPosition.xyz - lightPosition);

      vNormal = (modelMatrix * vec4(normal, 0.0)).xyz;
      vPosition = position;
      vLocalLightDirection = mat3(modelMatrix) * worldLightDirection;
      vLocalCameraPosition = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 dayColor;
    uniform vec3 nightColor;

    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vLocalLightDirection;
    varying vec3 vLocalCameraPosition;

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 viewDirection = normalize(vPosition - vLocalCameraPosition);
      vec3 normal = normalize(vNormal);
      vec3 lightDirection = normalize(-vLocalLightDirection);
      vec3 color = vec3(0.0);

      float lightIntensity = dot(lightDirection, normal);

      float haloDayMix = smoothstep(-0.5, 1.0, lightIntensity);
      vec3 haloColor = mix(nightColor, dayColor, haloDayMix);
      color += haloColor;

      float edgeAlpha = dot(viewDirection, normal);
      edgeAlpha = smoothstep(0.0, 1.0, edgeAlpha);

      float dayAlpha = smoothstep(-0.5, 0.0, lightIntensity);
      float alpha = edgeAlpha * dayAlpha;

      gl_FragColor = vec4(color, alpha);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
