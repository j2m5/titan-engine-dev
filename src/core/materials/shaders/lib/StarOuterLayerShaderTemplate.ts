import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Uniform, Color } from 'three'

export const StarOuterLayerShaderTemplate: ShaderProps = {
  uniforms: {
    uTime: new Uniform(0),
    uWidth: new Uniform(0.3),
    uAmp: new Uniform(0.5),
    uOpacity: new Uniform(0.2),
    uColorCool: new Uniform(new Color(1.0, 0.45, 0.25)),
    uColorBase: new Uniform(new Color(1.0, 0.8, 0.6)),
    uProtuberanceIntensity: new Uniform(6.0),
    uAlphaBlended: new Uniform(0.65),
    uNoiseFrequency: new Uniform(4),
    uNoiseAmplitude: new Uniform(0.2)
  },
  vertexShader: `
    precision highp float;

    // Атрибуты строит buildProminenceGeometry (renderables/utils/prominenceGeometry.ts).
    // Лента — дуга между двумя основаниями петли на единичной сфере
    attribute vec2 aRibbon;       // .x — фаза вдоль дуги (0..1), .y — сторона полосы (-1 / +1)
    attribute vec3 aFootA;        // направление первого основания петли
    attribute vec3 aFootB;        // направление второго основания
    attribute vec3 aRibbonRandom; // .x/.y — сдвиг и скорость вспышки (общие на группу лент), .z — микс цвета

    varying float vSide;
    varying float vOpacity;
    varying vec3  vColor;

    uniform float uWidth;
    uniform float uAmp;
    uniform float uTime;
    uniform float uNoiseFrequency;
    uniform float uNoiseAmplitude;
    uniform float uOpacity;
    uniform vec3 uColorCool;
    uniform vec3 uColorBase;
    uniform float uProtuberanceIntensity;

    // Фиксированная матрица перемешивания октав искривлённого синус-шума
    #define TWISTED_NOISE_MIX mat4(0.00, 0.80, 0.60, -0.4, -0.80, 0.36, -0.48, -0.5, -0.60, -0.48, 0.64, 0.2, 0.40, 0.30, 0.20, 0.4)

    vec4 twistedSineNoise(vec4 q, float falloff) {
      float a = 1.0;
      float f = 1.0;
      vec4 sum = vec4(0.0);
      for (int i = 0; i < 4; i++) {
        q = TWISTED_NOISE_MIX * q;
        vec4 s = sin(q.ywxz * f) * a;
        q += s;
        sum += s;
        a *= falloff;
        f /= falloff;
      }
      return sum;
    }

    // Точка дуги петли: основания соединяются напрямую, середина выгибается
    // наружу тем сильнее, чем дальше зашла вспышка
    vec3 arcPoint(float phase, float animPhase){
      float size = distance(aFootA, aFootB);
      vec3  n    = normalize((aFootA + aFootB) * 0.5);

      vec3 p = mix(aFootA, aFootB, phase);

      float amp = sin(phase * 3.14159265) * size * uAmp;
      amp *= animPhase;

      p += n * amp;

      p += twistedSineNoise(vec4(p * uNoiseFrequency, uTime), 0.707).xyz * (amp * uNoiseAmplitude);

      return p;
    }

    void main() {
      vSide = aRibbon.y;

      // Пила 0 -> 1 на группу лент: вспышка растёт и одновременно гаснет
      float animPhase = fract(uTime * 0.3 * (aRibbonRandom.y * 0.5) + aRibbonRandom.x);

      vec3 arc      = arcPoint(aRibbon.x,        animPhase);
      vec3 arcAhead = arcPoint(aRibbon.x + 0.01, animPhase);

      vec3 pW  = (modelMatrix * vec4(arc     , 1.0)).xyz;
      vec3 p1W = (modelMatrix * vec4(arcAhead, 1.0)).xyz;

      // Полоса развёрнута к камере: ширина откладывается поперёк дуги и взгляда
      vec3 tangentW    = normalize(p1W - pW);
      vec3 viewW       = normalize(pW - cameraPosition);
      vec3 ribbonSideW = normalize(cross(viewW, tangentW));

      // Единица ПО ПОСТРОЕНИЮ: основания — нормализованные направления в
      // объектном пространстве. Отсюда оба известных квирка ниже
      float R = length(aFootA);

      // КВИРК 1: полутолщина выходит в абсолютных мировых единицах (~0.3..0.6),
      // а не долей радиуса — у Солнца это около 0.15% диска, у карлика та же
      // лента относительно толще. Оставлено как есть: текущий вид принят с этим
      float width = uWidth * aRibbon.y * (1.0 + animPhase) * R;

      pW += ribbonSideW * width;

      vec3 centerW = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

      float lenW = length(pW - centerW);
      // КВИРК 2: гашение у поверхности неактивно — lenW мировая (у Солнца ~349
      // единиц), R объектная единица, так что smoothstep(1, 1.03, lenW) == 1.0
      // всегда. Починка меняет картинку, поэтому отложена
      vOpacity  = smoothstep(R, R * 1.03, lenW);
      vOpacity *= (1.0 - animPhase);
      vOpacity *= uOpacity;

      // Палитра ленты — чёрнотельная от температуры звезды (спред задаёт вызывающий
      // код, см. StarOuterLayer); ribbon premultiplied альфой ≤ uOpacity, поэтому
      // пик ~ uProtuberanceIntensity * uOpacity — ленты лишь слегка переходят порог блума
      vColor = mix(uColorCool, uColorBase, aRibbonRandom.z) * uProtuberanceIntensity;

      gl_Position = projectionMatrix * viewMatrix * vec4(pW, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;

    varying float vSide;
    varying float vOpacity;
    varying vec3  vColor;

    uniform float uAlphaBlended;

    void main() {
      // Мягкий поперечный край полосы: квадрат делает спад к краям круче
      float alpha = smoothstep(1.0, 0.0, abs(vSide));
      alpha *= alpha;
      alpha *= vOpacity;

      gl_FragColor = vec4(vColor * alpha, alpha * uAlphaBlended);
    }
  `
}
