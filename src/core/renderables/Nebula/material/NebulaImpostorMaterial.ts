import {
  AddEquation,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Texture,
  Uniform
} from 'three'

/**
 * Cheap camera-facing billboard for the far LOD. Displays a baked render-target
 * texture of the raymarched volume. The bake is composited premultiplied (the
 * raymarch outputs premultiplied alpha), so this material composites premultiplied
 * too (One, OneMinusSrcAlpha) to reproduce the volume's on-screen look exactly and
 * keep the raymarch<->impostor crossfade seamless.
 */
class NebulaImpostorMaterial extends ShaderMaterial {
  public constructor(map: Texture | null) {
    super({
      uniforms: {
        uMap: new Uniform(map),
        uOpacity: new Uniform(1),
        uLogDepthBufFC: new Uniform(1)
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      vertexShader: `
        uniform float uLogDepthBufFC; // logarithmic depth (matches scene + raymarch)
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = (log2(max(1e-6, 1.0 + gl_Position.w)) * uLogDepthBufFC - 1.0) * gl_Position.w;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uMap;
        uniform float uOpacity;
        void main() {
          // uMap is premultiplied; scaling premultiplied rgb+a by opacity is correct.
          gl_FragColor = texture2D(uMap, vUv) * uOpacity;
        }
      `
    })
  }
}

export { NebulaImpostorMaterial }
