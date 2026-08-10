import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Uniform, Color } from 'three'

export const StarOuterLayerShaderTemplate: ShaderProps = {
  uniforms: {
    uTime: new Uniform(0),
    uWidthFraction: new Uniform(0.00086),
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

    uniform float uWidthFraction;
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

      // ВИДОВОЕ пространство, а не мировое. modelViewMatrix три считает на CPU в
      // double, и абсолютный мировой сдвиг звезды сокращается с позицией камеры
      // ДО спуска во float32. Прежняя пара modelMatrix + viewMatrix перемножалась
      // уже в шейдере: у звезды, стоящей далеко от начала своей системы, вершины
      // квантовались шагом ULP мировой позиции. У Сириуса A это 0.029 юнита при
      // полутолщине ленты около 0.51 — то есть на толщину приходилось всего
      // полтора десятка ступеней, и ленты рябили. Солнце дефекта не показывает:
      // оно стоит в нуле своей системы, сдвиг нулевой
      vec3 pV  = (modelViewMatrix * vec4(arc     , 1.0)).xyz;
      vec3 p1V = (modelViewMatrix * vec4(arcAhead, 1.0)).xyz;

      // Полоса развёрнута к камере: ширина откладывается поперёк дуги и взгляда.
      // В видовом пространстве камера в начале координат, поэтому направление
      // взгляда — сама позиция точки, и cameraPosition больше не нужен
      vec3 tangentV    = normalize(p1V - pV);
      vec3 viewV       = normalize(pV);
      vec3 ribbonSideV = normalize(cross(viewV, tangentV));

      // Радиус звезды: aFootA — единичное направление, w = 0 отбрасывает перенос,
      // а масштаб меша равен радиусу (StarOuterLayer масштабирует себя им же).
      // Значение то же, что давала modelMatrix: viewMatrix — жёсткое движение и
      // длину не меняет. Отдельный юниформ не нужен; масштаб обязан оставаться
      // равномерным, иначе длина зависела бы от направления основания
      float starRadiusV = length((modelViewMatrix * vec4(aFootA, 0.0)).xyz);

      // Полутолщина — ДОЛЯ радиуса, а не абсолютные единицы: иначе у мелкой
      // звезды нити втрое толще относительно диска, чем у крупной.
      // 0.00086 подобрано так, что у Солнца толщина осталась прежней
      float width = uWidthFraction * aRibbon.y * (1.0 + animPhase) * starRadiusV;

      pV += ribbonSideV * width;

      // Гашение по ходу вспышки: чем выше поднялась лента, тем она прозрачнее
      vOpacity = (1.0 - animPhase) * uOpacity;

      // Палитра ленты — чёрнотельная от температуры звезды (спред задаёт вызывающий
      // код, см. StarOuterLayer); ribbon premultiplied альфой ≤ uOpacity, поэтому
      // пик ~ uProtuberanceIntensity * uOpacity — ленты лишь слегка переходят порог блума
      vColor = mix(uColorCool, uColorBase, aRibbonRandom.z) * uProtuberanceIntensity;

      gl_Position = projectionMatrix * vec4(pV, 1.0);
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
