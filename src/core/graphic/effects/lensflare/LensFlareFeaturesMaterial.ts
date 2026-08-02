import { NoBlending, ShaderMaterial, Uniform, Vector2, type ShaderMaterialParameters, type Texture } from 'three'

const vertexShader: string = `
  uniform vec2 texelSize;

  out vec2 vUv;
  out vec2 vAspectRatio;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    vAspectRatio = vec2(texelSize.x / texelSize.y, 1.0);
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

const fragmentShader: string = `
  #include <common>

  // ВНИМАНИЕ: несмотря на имя, здесь хранится 1/√2 (≈0.7071), а не √2
  // (≈1.4142). Переименовывать нельзя — константа пришла из внешнего кода
  // и используется в другой формуле (см. sampleGhost ниже)
  #define SQRT_2 0.7071067811865476

  uniform sampler2D inputBuffer;
  uniform sampler2D lensColor;
  uniform sampler2D starburst;

  uniform vec2 texelSize;
  uniform float ghostAmount;
  uniform float haloAmount;
  uniform float chromaticAberration;
  uniform float starburstRotation;
  uniform float starburstAmount;

  in vec2 vUv;
  in vec2 vAspectRatio;

  // Цвет призрака — из одномерного градиента по радиусу от центра кадра.
  // Так палитра всех девяти отражений принадлежит «объективу», а не набору
  // чисел, подобранных по одному
  // Нормировка обязана совпадать с той, что в sampleGhost ниже (0.5 * SQRT_2,
  // то есть 1/√2 половины диагонали) — иначе d здесь и d в спаде расходятся
  // вдвое, и правая половина градиента lensColor никогда не читается
  vec3 ghostTint(const vec2 suv) {
    float d = clamp(length(vec2(0.5) - suv) / (0.5 * SQRT_2), 0.0, 1.0);
    return texture(lensColor, vec2(d, 0.5)).rgb;
  }

  vec3 sampleGhost(const vec2 direction, const float weight, const float offset) {
    vec2 suv = clamp(1.0 - vUv + direction * offset, 0.0, 1.0);
    vec3 result = texture(inputBuffer, suv).rgb * ghostTint(suv) * weight;

    // Falloff at the perimeter.
    float d = clamp(length(0.5 - suv) / (0.5 * SQRT_2), 0.0, 1.0);
    result *= pow(1.0 - d, 3.0);
    return result;
  }

  vec4 sampleGhosts(float amount) {
    vec3 color = vec3(0.0);
    vec2 direction = vUv - 0.5;
    color += sampleGhost(direction, 0.9, -5.0);
    color += sampleGhost(direction, 0.8, -1.5);
    color += sampleGhost(direction, 0.9, -0.4);
    color += sampleGhost(direction, 0.8, -0.2);
    color += sampleGhost(direction, 0.75, -0.1);
    color += sampleGhost(direction, 0.65, 0.7);
    color += sampleGhost(direction, 0.5, 1.0);
    color += sampleGhost(direction, 0.85, 2.5);
    color += sampleGhost(direction, 0.8, 10.0);
    return vec4(color * amount, 1.0);
  }

  // Reference: https://john-chapman.github.io/2017/11/05/pseudo-lens-flare.html
  float cubicRingMask(const float x, const float radius, const float thickness) {
    float v = min(abs(x - radius) / thickness, 1.0);
    return 1.0 - v * v * (3.0 - 2.0 * v);
  }

  vec3 sampleHalo(const float radius) {
    vec2 direction = normalize((vUv - 0.5) / vAspectRatio) * vAspectRatio;
    vec3 offset = vec3(texelSize.x * chromaticAberration) * vec3(-1.0, 0.0, 1.0);
    vec2 suv = fract(1.0 - vUv + direction * radius);
    vec3 result = vec3(
      texture(inputBuffer, suv + direction * offset.r).r,
      texture(inputBuffer, suv + direction * offset.g).g,
      texture(inputBuffer, suv + direction * offset.b).b
    );

    // Falloff at the center and perimeter.
    vec2 wuv = (vUv - vec2(0.5, 0.0)) / vAspectRatio + vec2(0.5, 0.0);
    float d = saturate(distance(wuv, vec2(0.5)));
    result *= cubicRingMask(d, 0.45, 0.25);
    return result;
  }

  vec4 sampleHalos(const float amount) {
    vec3 color = vec3(0.0);
    color += sampleHalo(0.3);
    return vec4(color, 1.0) * amount;
  }

  // Лучи объектива. Маска повёрнута по ориентации камеры и НЕ привязана к
  // источнику света: она модулирует уже посчитанные артефакты.
  // Коррекция по vAspectRatio (тот же приём, что и в sampleHalo выше) переводит
  // координаты в квадратное пространство перед поворотом и возвращает обратно
  // после — без неё на не квадратном экране поворот превращается в сдвиговое
  // искажение, которое "гуляет" при крене камеры вместо чистого вращения
  float sampleStarburst() {
    vec2 centered = (vUv - 0.5) / vAspectRatio;
    float c = cos(starburstRotation);
    float s = sin(starburstRotation);
    vec2 rotated = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
    return texture(starburst, rotated * vAspectRatio + 0.5).r;
  }

  void main() {
    vec4 features = vec4(0.0);
    features += sampleGhosts(ghostAmount);
    features += sampleHalos(haloAmount);

    // при starburstAmount = 0 множитель равен 1.0 — маска тождественна
    gl_FragColor = features * (1.0 + starburstAmount * sampleStarburst());
  }
`

export interface LensFlareFeaturesMaterialParameters extends ShaderMaterialParameters {
  inputBuffer?: Texture | null
  lensColorTexture?: Texture | null
  starburstTexture?: Texture | null
  ghostAmount?: number
  haloAmount?: number
  chromaticAberration?: number
  starburstAmount?: number
}

export const lensFlareFeaturesMaterialParametersDefaults = {
  ghostAmount: 0.1,
  haloAmount: 0.1,
  chromaticAberration: 10,
  starburstAmount: 0
} satisfies LensFlareFeaturesMaterialParameters

export class LensFlareFeaturesMaterial extends ShaderMaterial {
  constructor(params?: LensFlareFeaturesMaterialParameters) {
    const {
      inputBuffer = null,
      lensColorTexture = null,
      starburstTexture = null,
      ghostAmount,
      haloAmount,
      chromaticAberration,
      starburstAmount,
      ...others
    } = {
      ...lensFlareFeaturesMaterialParametersDefaults,
      ...params
    }
    super({
      name: 'LensFlareFeaturesMaterial',
      fragmentShader,
      vertexShader,
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        inputBuffer: new Uniform(inputBuffer),
        lensColor: new Uniform(lensColorTexture),
        starburst: new Uniform(starburstTexture),
        texelSize: new Uniform(new Vector2()),
        ghostAmount: new Uniform(ghostAmount),
        haloAmount: new Uniform(haloAmount),
        chromaticAberration: new Uniform(chromaticAberration),
        starburstRotation: new Uniform(0),
        starburstAmount: new Uniform(starburstAmount),
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

  get lensColorTexture(): Texture | null {
    return this.uniforms.lensColor.value
  }

  set lensColorTexture(value: Texture | null) {
    this.uniforms.lensColor.value = value
  }

  get ghostAmount(): number {
    return this.uniforms.ghostAmount.value
  }

  set ghostAmount(value: number) {
    this.uniforms.ghostAmount.value = value
  }

  get haloAmount(): number {
    return this.uniforms.haloAmount.value
  }

  set haloAmount(value: number) {
    this.uniforms.haloAmount.value = value
  }

  get chromaticAberration(): number {
    return this.uniforms.chromaticAberration.value
  }

  set chromaticAberration(value: number) {
    this.uniforms.chromaticAberration.value = value
  }

  get starburstTexture(): Texture | null {
    return this.uniforms.starburst.value
  }

  set starburstTexture(value: Texture | null) {
    this.uniforms.starburst.value = value
  }

  get starburstRotation(): number {
    return this.uniforms.starburstRotation.value
  }

  set starburstRotation(value: number) {
    this.uniforms.starburstRotation.value = value
  }

  get starburstAmount(): number {
    return this.uniforms.starburstAmount.value
  }

  set starburstAmount(value: number) {
    this.uniforms.starburstAmount.value = value
  }
}
