import { AdditiveBlending, BackSide, Color, Matrix4, ShaderMaterial, Vector2, Vector3 } from 'three'
import { sceneDepthFunctions, sceneDepthUniforms } from '@/core/materials/shaders/lib/chunks/SceneDepth'

/** Шагов марша: конус аналитический, текстур нет — 24 хватает без полос */
const STEPS = 24
/** Потолок HDR — как у белого карлика */
const HDR_CEILING = 32

/**
 * Лучи-маяк пульсара: два гауссовых конуса вдоль магнитной оси (оба знака),
 * квадратичный спад по длине, ближнее гашение 2% длины (там светит гало).
 * Марш в кадре узла лучей, прокси — сфера радиуса uLength·1.05 (BackSide),
 * отрезок луча камеры режется по глубине сцены (чанк SceneDepth). Аддитивно,
 * без записи глубины. CPU-зеркало плотности — beamKinematics.beamDensity.
 */
export class PulsarBeamsMaterial extends ShaderMaterial {
  public constructor() {
    super({
      uniforms: {
        uInvModelMatrix: { value: new Matrix4() },
        uCameraLocal: { value: new Vector3() },
        uAxis: { value: new Vector3(0, 1, 0) },
        uHalfAngle: { value: 0.1 },
        uLength: { value: 1 },
        uColor: { value: new Color(0xbcd4ff) },
        uIntensity: { value: 0 },
        uSceneDepth: { value: null },
        uResolution: { value: new Vector2(1, 1) },
        uLogFarFactor: { value: 1 },
        uSceneDepthEnabled: { value: 0 }
      },
      vertexShader: `
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform mat4 uInvModelMatrix;
        uniform vec3 uCameraLocal;
        uniform vec3 uAxis;
        uniform float uHalfAngle;
        uniform float uLength;
        uniform vec3 uColor;
        uniform float uIntensity;
        ${sceneDepthUniforms}
        varying vec3 vLocal;
        ${sceneDepthFunctions}

        // Плотность луча — то же выражение, что beamDensity на CPU
        float beamDensity(vec3 p) {
          float d = length(p);
          if (d <= 0.0 || d >= uLength) return 0.0;
          float cosA = min(1.0, abs(dot(p, uAxis)) / d);
          float angle = acos(cosA);
          float angular = exp(-(angle / uHalfAngle) * (angle / uHalfAngle));
          float radial = (1.0 - d / uLength) * (1.0 - d / uLength);
          float near = smoothstep(0.0, 0.02 * uLength, d);
          return uIntensity * angular * radial * near;
        }

        void main() {
          vec3 rayDir = normalize(vLocal - uCameraLocal);
          // Пересечение луча со сферой прокси радиуса R = uLength·1.05; камера
          // внутри — отрезок от нуля
          float R = uLength * 1.05;
          float b = dot(uCameraLocal, rayDir);
          float c = dot(uCameraLocal, uCameraLocal) - R * R;
          float disc = b * b - c;
          if (disc <= 0.0) discard;
          float s = sqrt(disc);
          float t0 = max(-b - s, 0.0);
          float t1 = -b + s;
          t1 = min(t1, sceneDepthRayT(mat3(modelViewMatrix) * rayDir));
          if (t1 <= t0) discard;

          float dt = (t1 - t0) / float(${STEPS});
          vec3 accum = vec3(0.0);
          for (int i = 0; i < ${STEPS}; i++) {
            float t = t0 + (float(i) + 0.5) * dt;
            accum += uColor * beamDensity(uCameraLocal + rayDir * t) * dt / uLength;
          }
          gl_FragColor = vec4(min(accum, vec3(${HDR_CEILING}.0)), 1.0);
        }
      `,
      side: BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending
    })
  }
}
