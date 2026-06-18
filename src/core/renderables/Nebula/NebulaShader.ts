import { Color, IUniform, Uniform, Vector3 } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { NebulaParameters } from '@/core/renderables/Nebula/NebulaParameters'

class NebulaShader extends AbstractShader {
  public constructor(parameters: NebulaParameters) {
    const uniforms: Record<string, IUniform> = {
      uEmissionColor: new Uniform<Color>(parameters.emissionColor.clone()),
      uRadius: new Uniform<number>(parameters.radius),
      uIntensity: new Uniform<number>(parameters.intensity),
      uEmissionStrength: new Uniform<number>(parameters.emissionStrength),
      uBloomThreshold: new Uniform<number>(parameters.bloomThreshold),
      uAbsorptionPower: new Uniform<number>(parameters.absorptionPower),

      // FBM
      uSeed: new Uniform<number>(parameters.seed),
      uNoiseFrequency: new Uniform<number>(parameters.noiseFrequency),
      uDensityThreshold: new Uniform<number>(parameters.densityThreshold),
      uDensityScale: new Uniform<number>(parameters.densityScale),

      // March
      uSigma: new Uniform<number>(parameters.sigma),

      // Геометрия луча (заполняется в NebulaMaterial.update каждый кадр)
      uCameraLocal: new Uniform<Vector3>(new Vector3())
    }

    // Октавы и шаги марша — константы цикла GLSL, только через #define
    const defines: Record<string, any> = {
      NEBULA_OCTAVES: parameters.octaves,
      NEBULA_STEPS: parameters.marchSteps
    }

    const vertexShader = /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      varying vec3 vLocalPos;

      void main() {
        vLocalPos = position;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `

    const fragmentShader = /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      #include <noiseFunctions>

      uniform vec3 uEmissionColor;
      uniform float uRadius;
      uniform float uIntensity;
      uniform float uEmissionStrength;
      uniform float uBloomThreshold;
      uniform float uAbsorptionPower;

      uniform float uSeed;
      uniform float uNoiseFrequency;
      uniform float uDensityThreshold;
      uniform float uDensityScale;

      uniform float uSigma;

      uniform vec3 uCameraLocal;

      varying vec3 vLocalPos;

      // дешёвый экранный хеш для джиттера старта луча (против бандинга)
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      // ── FBM по 4D Simplex (4-я координата = seed) ──
      float fbm(vec3 p) {
        float sum = 0.0;
        float amp = 0.5;
        float freq = 1.0;
        for (int i = 0; i < NEBULA_OCTAVES; i++) {
          sum += amp * snoise(vec4(p * freq, uSeed));
          freq *= 2.0;
          amp *= 0.5;
        }
        return sum;
      }

      // ── Плотность газа в локальной точке ──
      float sampleDensity(vec3 localPos) {
        // нормируем в [-1,1] по радиусу. Туманности статичны в человеческих
        // масштабах времени — анимация клубления намеренно отсутствует.
        vec3 p = localPos / uRadius;
        vec3 q = p * uNoiseFrequency;

        float n = fbm(q);                 // примерно [-1, 1]
        float d = n * 0.5 + 0.5;          // в [0, 1]

        // порог вырезает полости, остаток масштабируем
        d = max(d - uDensityThreshold, 0.0) * uDensityScale;

        // мягкое затухание плотности к сферической границе внутри куба,
        // чтобы объём не обрывался на гранях
        float edge = 1.0 - smoothstep(0.8, 1.0, length(p));
        return d * edge;
      }

      // ── Slab-пересечение луча с AABB [-uRadius, +uRadius]³ ──
      // возвращает vec2(tNear, tFar); промах если y < x
      vec2 intersectAABB(vec3 ro, vec3 rd) {
        vec3 inv = 1.0 / rd;
        vec3 t0 = (vec3(-uRadius) - ro) * inv;
        vec3 t1 = (vec3( uRadius) - ro) * inv;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        float tNear = max(max(tmin.x, tmin.y), tmin.z);
        float tFar  = min(min(tmax.x, tmax.y), tmax.z);
        return vec2(tNear, tFar);
      }

      void main() {
        #include <logdepthbuf_fragment>

        // Луч в ЛОКАЛЬНОМ пространстве куба:
        // начало — локальная позиция камеры; направление — от камеры к
        // текущей точке поверхности (vLocalPos уже локальна).
        vec3 ro = uCameraLocal;
        vec3 dir = vLocalPos - uCameraLocal;
        // защита от вырожденного направления (камера почти на грани)
        if (dot(dir, dir) < 1e-8) discard;
        vec3 rd = normalize(dir);

        vec2 hit = intersectAABB(ro, rd);
        float tNear = hit.x;
        float tFar  = hit.y;

        // промах или объём целиком позади камеры
        if (tFar < tNear || tFar < 0.0) discard;

        // ВЛЕТАЕМОСТЬ: снаружи стартуем от входа, изнутри — от камеры (t=0)
        float tStart = max(tNear, 0.0);

        float stepSize = (tFar - tStart) / float(NEBULA_STEPS);

        // blue-noise джиттер старта: смещаем первый сэмпл на долю шага по
        // экранному хешу. Размазывает регулярную сетку сэмплов — устраняет
        // полосатый бандинг, позволяя обойтись меньшим числом шагов.
        float jitter = hash12(gl_FragCoord.xy);
        tStart += jitter * stepSize;

        vec3 accumColor = vec3(0.0);
        float accumA = 0.0;

        for (int i = 0; i < NEBULA_STEPS; i++) {
          float t = tStart + (float(i) + 0.5) * stepSize;
          vec3 samplePos = ro + rd * t;

          float density = sampleDensity(samplePos);
          if (density > 0.001) {
            // Поглощение использует СЖАТУЮ плотность (density^uAbsorptionPower,
            // power < 1), чтобы плотные ядра не уходили в насыщение альфы и
            // оставались полупрозрачными — сквозь оптически тонкую туманность
            float densAbs = pow(density, uAbsorptionPower);
            float a = 1.0 - exp(-densAbs * stepSize * uSigma);

            // плотные зоны остаются яркими/окрашенными, но прозрачными.
            float dl = stepSize / uRadius;
            vec3 emission = uEmissionColor * uIntensity * uEmissionStrength
                          * density * dl;

            accumColor += (1.0 - accumA) * emission;
            accumA     += (1.0 - accumA) * a;

            if (accumA > 0.99) break;
          }
        }

        float lum = dot(accumColor, vec3(0.2126, 0.7152, 0.0722));

        // tone-подобный roll-off тела к порогу, ядра (lum > threshold) проходят
        float k = uBloomThreshold;
        accumColor *= k / (k + lum);   // мягко прижимает яркость к ~k
        // ядра вытягиваем обратно над порог пропорц. избыточной плотности
        accumColor += accumColor * smoothstep(k, k * 1.5, lum) * 0.6;

        float lum2 = dot(accumColor, vec3(0.2126, 0.7152, 0.0722));
        float outA = clamp(max(accumA, lum2), 0.0, 1.0);

        if (outA < 0.001) discard;

        gl_FragColor = vec4(accumColor, outA);
      }
    `

    super({
      name: 'NebulaShader',
      uniforms,
      defines,
      vertexShader,
      fragmentShader
    })
  }
}

export { NebulaShader }
