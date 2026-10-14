import { ShaderMaterial, NoBlending, type Texture } from 'three'
export function createEarthHdrBlendMaterial(far: Texture, near: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { farMap: { value: far }, nearMap: { value: near }, weight: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D farMap;
      uniform sampler2D nearMap;
      uniform float weight;
      varying vec2 vUv;
      void main() {
        if (weight <= 0.0) gl_FragColor = texture2D(farMap, vUv);
        else if (weight >= 1.0) gl_FragColor = texture2D(nearMap, vUv);
        else gl_FragColor = mix(texture2D(farMap, vUv), texture2D(nearMap, vUv), weight);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: NoBlending
  })
}
