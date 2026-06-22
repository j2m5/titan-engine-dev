import { Color, IUniform, Uniform, Vector3 } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { NebulaParameters } from '@/core/renderables/Nebula/NebulaParameters'

class NebulaShader extends AbstractShader {
  public constructor(parameters: NebulaParameters) {
    const uniforms: Record<string, IUniform> = {
      uShapeStrength: new Uniform<number>(parameters.shapeStrength),
      uShapeThickness: new Uniform<number>(parameters.shapeThickness),
      uEmissionColor: new Uniform<Color>(parameters.emissionColor.clone()),
      uColorLow: new Uniform<Color>(parameters.colorLow.clone()),
      uColorHigh: new Uniform<Color>(parameters.colorHigh.clone()),
      uColorEdge: new Uniform<Color>(parameters.colorEdge.clone()),
      uColorMixPower: new Uniform<number>(parameters.colorMixPower),
      uRadius: new Uniform<number>(parameters.radius),
      uIntensity: new Uniform<number>(parameters.intensity),
      uEmissionStrength: new Uniform<number>(parameters.emissionStrength),
      uBloomThreshold: new Uniform<number>(parameters.bloomThreshold),
      uAbsorptionPower: new Uniform<number>(parameters.absorptionPower),
      uWarpStrength: new Uniform<number>(parameters.warpStrength),
      uAnisotropy: new Uniform<Vector3>(parameters.anisotropy.clone()),
      uEdgeHardness: new Uniform<number>(parameters.edgeHardness),

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
      NEBULA_STEPS: parameters.marchSteps,
      NEBULA_SHAPE: parameters.shapeType
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

      uniform float uShapeStrength;
      uniform float uShapeThickness;
      uniform vec3 uEmissionColor;
      uniform vec3 uColorLow;
      uniform vec3 uColorHigh;
      uniform vec3 uColorEdge;
      uniform float uColorMixPower;
      uniform float uRadius;
      uniform float uIntensity;
      uniform float uEmissionStrength;
      uniform float uBloomThreshold;
      uniform float uAbsorptionPower;
      uniform float uWarpStrength;
      uniform vec3 uAnisotropy;
      uniform float uEdgeHardness;

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

      float fbm(vec3 p) {
        vec3 sp = p + fract(uSeed * 0.1731) * 10.0;  // сдвиг в [0..10]
        float sum = 0.0;
        float amp = 0.5;
        float freq = 1.0;
        for (int i = 0; i < NEBULA_OCTAVES; i++) {
          sum += amp * snoise(sp * freq);
          freq *= 2.0;
          amp *= 0.5;
        }
        return sum;
      }

      float fbmWarp(vec3 p, vec3 offset) {
        float seedShift = fract(uSeed * 0.1731) * 10.0;
        return snoise(p + offset + seedShift);
      }

      vec3 warpField(vec3 p) {
        return vec3(
          fbmWarp(p, vec3( 0.0,   0.0,   0.0)),
          fbmWarp(p, vec3(31.4,  17.7,  42.1)),
          fbmWarp(p, vec3(73.2,  91.5,  12.8))
        );
      }

      float shapeShell(vec3 p) {
        float r = length(p);
        vec3 dir = normalize(p + 1e-5);
        float radVar = snoise(dir * 2.3 + fract(uSeed * 0.1731) * 10.0) * 0.18;
        float shellR = 0.62 + radVar;
        float d = abs(r - shellR);
        float thick = uShapeThickness * (0.7 + 0.6 * snoise(dir * 4.1));
        return 1.0 - smoothstep(0.0, thick, d);
      }

      float shapeBipolar(vec3 p) {
        float ax = abs(p.y);
        float radial = length(p.xz);
        float coneWidth = 0.15 + ax * 0.9;
        float lobe = 1.0 - smoothstep(coneWidth * 0.5, coneWidth, radial);
        float lenFall = 1.0 - smoothstep(0.6, 1.0, ax);
        float waist = smoothstep(0.05, 0.25, ax);
        return lobe * lenFall * waist;
      }

      float shapeDisk(vec3 p) {
        float radial = length(p.xz);
        float angle = atan(p.z, p.x);
        float rimVar = snoise(vec3(cos(angle), sin(angle), 0.0) * 2.0
                       + fract(uSeed * 0.1731) * 10.0) * 0.15;
        float rim = 1.0 - smoothstep(0.6 + rimVar, 1.0 + rimVar, radial);
        float thick = uShapeThickness * (0.6 + 0.8 * snoise(vec3(p.xz * 3.0, p.y * 3.0)));
        float vert = 1.0 - smoothstep(0.0, thick, abs(p.y));
        return vert * rim;
      }

      float shapeMask(vec3 p) {
        #if NEBULA_SHAPE == 1
          return shapeShell(p);
        #elif NEBULA_SHAPE == 2
          return shapeBipolar(p);
        #elif NEBULA_SHAPE == 3
          return shapeDisk(p);
        #else
          return 1.0;
        #endif
      }

      // ── Плотность газа в локальной точке ──
      float sampleDensity(vec3 localPos) {
        vec3 p = localPos / uRadius;

        vec3 q = p * uNoiseFrequency;

        vec3 warped = q + uWarpStrength * warpField(q);
        float n = fbm(warped);
        float d = n * 0.5 + 0.5;
        d = max(d - uDensityThreshold, 0.0) * uDensityScale;

        float edgeNoise = snoise(p * 1.7 + fract(uSeed * 0.1731) * 10.0);
        float rad = length(p);
        float distort = (1.0 - uEdgeHardness) * (0.45 * edgeNoise + 0.2 * n);
        float noisyEdge = rad - distort;
        float edge = 1.0 - smoothstep(0.45, 1.0, noisyEdge);
        d *= edge;

        #if NEBULA_SHAPE != 0
          vec3 shapeOffset = vec3(
            snoise(p * 0.8 + 11.0),
            snoise(p * 0.8 + 23.0),
            snoise(p * 0.8 + 37.0)
          ) * 0.12;
          float shape = shapeMask(p + shapeOffset);
          d *= mix(1.0, shape, uShapeStrength);
        #endif

        return d;
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
            float densAbs = pow(density, uAbsorptionPower);
            float a = 1.0 - exp(-densAbs * stepSize * uSigma);

            float dl = stepSize / uRadius;

            // нормированный радиус точки сэмпла (samplePos уже в локали куба)
            float sampleRad = clamp(length(samplePos) / uRadius, 0.0, 1.0);

            // цвет по плотности: тело (low) → ядра (high)
            float densMix = pow(clamp(density, 0.0, 1.0), uColorMixPower);
            vec3 gasColor = mix(uColorLow, uColorHigh, densMix);

            // радиальная модуляция: к краям подмешиваем colorEdge
            gasColor = mix(gasColor, uColorEdge, smoothstep(0.5, 1.0, sampleRad));

            vec3 emission = gasColor * uIntensity * uEmissionStrength
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
