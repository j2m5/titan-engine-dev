import { NoBlending, ShaderMaterial, Uniform, Vector2, type ShaderMaterialParameters, type Texture } from 'three'

const vertexShader: string = `
  uniform vec2 texelSize;

  out vec2 vCenterUv1;
  out vec2 vCenterUv2;
  out vec2 vCenterUv3;
  out vec2 vCenterUv4;
  out vec2 vRowUv1;
  out vec2 vRowUv2;
  out vec2 vRowUv3;
  out vec2 vRowUv4;
  out vec2 vRowUv5;
  out vec2 vRowUv6;
  out vec2 vRowUv7;
  out vec2 vRowUv8;
  out vec2 vRowUv9;

  void main() {
    vec2 uv = position.xy * 0.5 + 0.5;
    vCenterUv1 = uv + texelSize * vec2(-1.0, 1.0);
    vCenterUv2 = uv + texelSize * vec2(1.0, 1.0);
    vCenterUv3 = uv + texelSize * vec2(-1.0, -1.0);
    vCenterUv4 = uv + texelSize * vec2(1.0, -1.0);
    vRowUv1 = uv + texelSize * vec2(-2.0, 2.0);
    vRowUv2 = uv + texelSize * vec2(0.0, 2.0);
    vRowUv3 = uv + texelSize * vec2(2.0, 2.0);
    vRowUv4 = uv + texelSize * vec2(-2.0, 0.0);
    vRowUv5 = uv + texelSize;
    vRowUv6 = uv + texelSize * vec2(2.0, 0.0);
    vRowUv7 = uv + texelSize * vec2(-2.0, -2.0);
    vRowUv8 = uv + texelSize * vec2(0.0, -2.0);
    vRowUv9 = uv + texelSize * vec2(2.0, -2.0);

    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

const fragmentShader: string = `
  #include <common>

  uniform sampler2D inputBuffer;

  uniform float thresholdLevel;
  uniform float thresholdRange;

  in vec2 vCenterUv1;
  in vec2 vCenterUv2;
  in vec2 vCenterUv3;
  in vec2 vCenterUv4;
  in vec2 vRowUv1;
  in vec2 vRowUv2;
  in vec2 vRowUv3;
  in vec2 vRowUv4;
  in vec2 vRowUv5;
  in vec2 vRowUv6;
  in vec2 vRowUv7;
  in vec2 vRowUv8;
  in vec2 vRowUv9;

  float clampToBorder(const vec2 uv) {
    return float(uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0);
  }

  // Reference: https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom
  void main() {
    vec3 color = 0.125 * texture(inputBuffer, vec2(vRowUv5)).rgb;
    vec4 weight =
      0.03125 *
      vec4(
        clampToBorder(vRowUv1),
        clampToBorder(vRowUv3),
        clampToBorder(vRowUv7),
        clampToBorder(vRowUv9)
      );
    color += weight.x * texture(inputBuffer, vec2(vRowUv1)).rgb;
    color += weight.y * texture(inputBuffer, vec2(vRowUv3)).rgb;
    color += weight.z * texture(inputBuffer, vec2(vRowUv7)).rgb;
    color += weight.w * texture(inputBuffer, vec2(vRowUv9)).rgb;

    weight =
      0.0625 *
      vec4(
        clampToBorder(vRowUv2),
        clampToBorder(vRowUv4),
        clampToBorder(vRowUv6),
        clampToBorder(vRowUv8)
      );
    color += weight.x * texture(inputBuffer, vec2(vRowUv2)).rgb;
    color += weight.y * texture(inputBuffer, vec2(vRowUv4)).rgb;
    color += weight.z * texture(inputBuffer, vec2(vRowUv6)).rgb;
    color += weight.w * texture(inputBuffer, vec2(vRowUv8)).rgb;

    weight =
      0.125 *
      vec4(
        clampToBorder(vRowUv2),
        clampToBorder(vRowUv4),
        clampToBorder(vRowUv6),
        clampToBorder(vRowUv8)
      );
    color += weight.x * texture(inputBuffer, vec2(vCenterUv1)).rgb;
    color += weight.y * texture(inputBuffer, vec2(vCenterUv2)).rgb;
    color += weight.z * texture(inputBuffer, vec2(vCenterUv3)).rgb;
    color += weight.w * texture(inputBuffer, vec2(vCenterUv4)).rgb;

    // WORKAROUND: Avoid screen flashes if the input buffer contains NaN texels.
    // See: https://github.com/takram-design-engineering/three-geospatial/issues/7
    if (any(isnan(color))) {
      gl_FragColor = vec4(vec3(0.0), 1.0);
      return;
    }

    float l = luminance(color);
    float scale = saturate(smoothstep(thresholdLevel, thresholdLevel + thresholdRange, l));
    gl_FragColor = vec4(color * scale, 1.0);
  }
`

export interface DownsampleThresholdMaterialParameters extends ShaderMaterialParameters {
  inputBuffer?: Texture | null
  thresholdLevel?: number
  thresholdRange?: number
}

export const downsampleThresholdMaterialParametersDefaults = {
  thresholdLevel: 1,
  thresholdRange: 0.3
} satisfies DownsampleThresholdMaterialParameters

export class DownsampleThresholdMaterial extends ShaderMaterial {
  constructor(params?: DownsampleThresholdMaterialParameters) {
    const {
      inputBuffer = null,
      thresholdLevel,
      thresholdRange,
      ...others
    } = {
      ...downsampleThresholdMaterialParametersDefaults,
      ...params
    }
    super({
      name: 'DownsampleThresholdMaterial',
      fragmentShader,
      vertexShader,
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      ...others,
      uniforms: {
        inputBuffer: new Uniform(inputBuffer),
        texelSize: new Uniform(new Vector2()),
        thresholdLevel: new Uniform(thresholdLevel),
        thresholdRange: new Uniform(thresholdRange),
        ...others.uniforms
      }
    })
  }

  setSize(width: number, height: number): void {
    this.uniforms.texelSize.value.set(1 / width, 1 / height)
  }

  get inputBuffer(): Texture | null {
    return this.uniforms.inputBuffer.value
  }

  set inputBuffer(value: Texture | null) {
    this.uniforms.inputBuffer.value = value
  }

  get thresholdLevel(): number {
    return this.uniforms.thresholdLevel.value
  }

  set thresholdLevel(value: number) {
    this.uniforms.thresholdLevel.value = value
  }

  get thresholdRange(): number {
    return this.uniforms.thresholdRange.value
  }

  set thresholdRange(value: number) {
    this.uniforms.thresholdRange.value = value
  }
}
