import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'

export const InstancedAsteroidShaderTemplate: ShaderProps = {
  uniforms: {
    lightPosition: new Uniform(new Vector3()),
    diffuseMap: new Uniform(null),
    nightMap: new Uniform(null),
    minDistance: new Uniform(toThreeJSUnits(100)),
    maxDistance: new Uniform(toThreeJSUnits(5000))
  },
  vertexShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vPositionW;
    varying vec3 vLocalCameraPosition;

    void main() {
      vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * worldPosition;

      gl_Position = projectionMatrix * mvPosition;

      vUv = uv;
      vNormal = (instanceMatrix * vec4(normal, 0.0)).xyz;
      vPosition = position;
      vPositionW = worldPosition.xyz;
      vLocalCameraPosition = (inverse(modelMatrix * instanceMatrix) * vec4(cameraPosition, 1.0)).xyz;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 lightPosition;
    uniform sampler2D diffuseMap;
    uniform sampler2D nightMap;
    uniform float minDistance;
    uniform float maxDistance;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vPositionW;
    varying vec3 vLightPosition;
    varying vec3 vLocalCameraPosition;

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 normal = normalize(vNormal);

      vec3 lightDirection = normalize(vPositionW - lightPosition);
      float lightIntensity = max(dot(normal, lightDirection), 0.0);

      float distance = length(vLocalCameraPosition - vPosition);
      float transparencyFactor = 1.0 - smoothstep(minDistance, maxDistance, distance);

      vec3 dayColor = texture2D(diffuseMap, vUv).rgb;
      vec3 nightColor = texture2D(nightMap, vUv).rgb;

      vec3 day = dayColor;
      vec3 night = nightColor * nightColor;

      vec3 finalColor = mix(night, day, lightIntensity);

      if (transparencyFactor == 0.0) discard;

      gl_FragColor = vec4(finalColor, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
