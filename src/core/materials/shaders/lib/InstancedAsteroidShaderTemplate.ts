import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'

export const InstancedAsteroidShaderTemplate: ShaderProps = {
  uniforms: {
    lightPosition: new Uniform(new Vector3()),
    diffuseMap: new Uniform(null),
    bumpMap: new Uniform(null),
    nightMap: new Uniform(null),
    bumpScale: new Uniform(0),
    minDistance: new Uniform(toThreeJSUnits(100)),
    maxDistance: new Uniform(toThreeJSUnits(5000))
  },
  vertexShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;

    void main() {
      vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * worldPosition;

      gl_Position = projectionMatrix * mvPosition;

      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);
      mat3 instanceNormalMatrix = mat3(instanceMatrix);
      vec3 transformedNormal = normalize(instanceNormalMatrix * normal);

      vUv = uv;
      vNormal = normalize(normalMatrix * transformedNormal);
      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vViewPosition = -mvPosition.xyz;

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 lightPosition;
    uniform sampler2D diffuseMap;
    uniform sampler2D bumpMap;
    uniform sampler2D nightMap;
    uniform float bumpScale;
    uniform float minDistance;
    uniform float maxDistance;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;

    #include <bumpFunctions>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 normal = normalize(vNormal);

      float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
      normal = perturbNormalArb(-vViewPosition, normal, dHdxy_fwd(), faceDirection);

      vec3 lightDirection = normalize(vViewLightDirection);
      float lightIntensity = max(dot(normal, lightDirection), 0.0);

      vec3 dayColor = texture2D(diffuseMap, vUv).rgb;
      vec3 nightColor = texture2D(nightMap, vUv).rgb;

      vec3 day = dayColor;
      vec3 night = nightColor * nightColor;

      float dist = length(vViewPosition);
      float fade = 1.0 - smoothstep(minDistance, maxDistance, dist);

      //if (fade <= 0.0) discard;

      vec3 finalColor = mix(night, day, lightIntensity);

      gl_FragColor = vec4(finalColor, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
