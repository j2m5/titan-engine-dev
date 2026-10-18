import { GLSL3, Matrix4, NoBlending, ShaderMaterial, Uniform, Vector2 } from 'three'

/** Fullscreen HDR history resolve. Textures are bound only for the duration of its draw. */
export class DepthVolumeTemporalMaterial extends ShaderMaterial {
  public constructor() {
    super({
      glslVersion: GLSL3, blending: NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        currentColor: new Uniform(null), currentPosition: new Uniform(null),
        historyColor: new Uniform(null), historyPosition: new Uniform(null),
        previousClip: new Uniform(new Matrix4()), currentClip: new Uniform(new Matrix4()),
        imageSize: new Uniform(new Vector2()), historyWeight: new Uniform(0)
      },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        precision highp float;
        uniform sampler2D currentColor;
        uniform sampler2D currentPosition;
        uniform sampler2D historyColor;
        uniform sampler2D historyPosition;
        uniform mat4 previousClip;
        uniform mat4 currentClip;
        uniform vec2 imageSize;
        uniform float historyWeight;
        layout(location = 0) out vec4 color;
        layout(location = 1) out vec4 position;
        void main() {
          ivec2 pixel = ivec2(gl_FragCoord.xy);
          color = texelFetch(currentColor, pixel, 0);
          position = texelFetch(currentPosition, pixel, 0);
          if (historyWeight <= 0.0 || position.a < 0.5) return;

          vec4 oldClip = previousClip * vec4(position.xyz, 1.0);
          if (oldClip.w <= 0.0) return;
          vec2 oldUV = oldClip.xy / oldClip.w * 0.5 + 0.5;
          vec2 margin = 0.5 / imageSize;
          if (any(lessThan(oldUV, margin)) || any(greaterThan(oldUV, 1.0 - margin))) return;

          vec2 oldPixel = oldUV * imageSize - 0.5;
          ivec2 base = ivec2(floor(oldPixel));
          ivec2 lastPixel = ivec2(imageSize) - 1;
          vec2 f = fract(oldPixel);
          vec4 weights = vec4((1.0-f.x)*(1.0-f.y), f.x*(1.0-f.y), (1.0-f.x)*f.y, f.x*f.y);
          vec4 history = vec4(0.0);
          for (int i = 0; i < 4; i++) {
            if (weights[i] < 1e-5) continue;
            ivec2 tap = clamp(base + ivec2(i % 2, i / 2), ivec2(0), lastPixel);
            vec4 oldPosition = texelFetch(historyPosition, tap, 0);
            // Opaque depth cuts never contribute history; this includes freshly
            // revealed pixels and the old silhouette of a moving occluder.
            if (oldPosition.a < 0.5 || distance(oldPosition.xyz, position.xyz) > 0.35) return;
            vec4 back = currentClip * vec4(oldPosition.xyz, 1.0);
            if (back.w <= 0.0) return;
            vec2 backPixel = (back.xy / back.w * 0.5 + 0.5) * imageSize;
            if (distance(backPixel, gl_FragCoord.xy) > 1.5) return;
            history += texelFetch(historyColor, tap, 0) * weights[i];
          }

          vec4 lo = color, hi = color;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec4 sampleColor = texelFetch(currentColor, clamp(pixel + ivec2(x,y), ivec2(0), lastPixel), 0);
            lo = min(lo, sampleColor);
            hi = max(hi, sampleColor);
          }
          // Keep linear, premultiplied HDR, including RGB with zero opacity.
          // Faster motion reduces persistence even when position checks pass.
          float motion = distance(oldUV * imageSize, gl_FragCoord.xy);
          float blend = historyWeight / (1.0 + 0.25 * motion);
          color = mix(color, clamp(history, lo, hi), blend);
        }
      `
    })
  }

  public unbind(): void {
    for (const name of ['currentColor', 'currentPosition', 'historyColor', 'historyPosition']) this.uniforms[name].value = null
  }
}
