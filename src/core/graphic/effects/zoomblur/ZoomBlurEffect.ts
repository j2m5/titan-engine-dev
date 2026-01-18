import { BlendFunction, Effect } from 'postprocessing'
import { Uniform } from 'three'

export type ZoomBlurEffectOptions = {
  blendFunction?: BlendFunction
  strength?: number
}

const fragmentShader: string = `
  uniform float strength;

  float random(vec3 scale, float seed) {
    return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 color = vec4(0.0);
    float total = 0.0;
    vec2 center = vec2(0.5) - uv;

    float offset = random(vec3(12.9898, 78.233, 151.7182), 0.0);

    for (float t = 0.0; t <= 40.0; t++) {
      float percent = (t + offset) / 40.0;
      float weight = 4.0 * (percent - percent * percent);

      vec2 shift = center * percent * strength;

      vec2 uvR = uv + shift + 0.3 * vec2(0.002, 0.0);
      vec2 uvG = uv + shift;
      vec2 uvB = uv + shift - 0.3 * vec2(0.002, 0.0);

      vec4 sampR = texture2D(inputBuffer, uvR);
      vec4 sampG = texture2D(inputBuffer, uvG);
      vec4 sampB = texture2D(inputBuffer, uvB);

      vec4 samp = vec4(sampR.r, sampG.g, sampB.b, sampG.a);

      samp.rgb *= samp.a;

      color += samp * weight;
      total += weight;
    }

    outputColor = color / total;
    outputColor.rgb /= outputColor.a + 0.00001;
  }
`

class ZoomBlurEffect extends Effect {
  public constructor(config: ZoomBlurEffectOptions) {
    super('ZoomBlurEffect', fragmentShader, {
      blendFunction: config.blendFunction || BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([['strength', new Uniform(config.strength)]])
    })
  }
}

export { ZoomBlurEffect }
