import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Uniform, Vector2, Vector3 } from 'three'

export const BlackHoleDistortionShaderTemplate: ShaderProps = {
  uniforms: {
    resolution: new Uniform(new Vector2()),
    cameraWorldPosition: new Uniform(new Vector3()),
    centerPosition: new Uniform(new Vector3()),
    simulationRadius: new Uniform(0),
    blackHoleMass: new Uniform(0),
    innerAccretionDiskRadius: new Uniform(0),
    outerAccretionDiskRadius: new Uniform(0),
    accretionDiskHeight: new Uniform(0),
    steps: new Uniform(0),
    stepSize: new Uniform(0),
    starMap: new Uniform(null),
    noiseTexture: new Uniform(null)
  },
  vertexShader: `
    precision highp float;

    uniform vec3 cameraWorldPosition;

    varying vec3 vDirection;

    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vDirection = normalize(worldPos.xyz - cameraWorldPosition);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;

    varying vec3 vDirection;

    uniform vec2 resolution;
    uniform vec3 cameraWorldPosition;
    uniform vec3 centerPosition;
    uniform float simulationRadius;
    uniform float blackHoleMass;
    uniform float innerAccretionDiskRadius;
    uniform float outerAccretionDiskRadius;
    uniform float accretionDiskHeight;
    uniform int steps;
    uniform float stepSize;

    uniform sampler2D starMap;

    uniform sampler2D noiseTexture;

    void stepRay(inout vec4 x, inout vec4 p, inout vec4 prevX, inout vec4 prevP, inout vec4 color, in int i);
    mat4 metric(vec4 x);
    mat4 metricInverse(vec4 x);
    vec4 hamiltonianGradient(vec4 x, vec4 p);
    vec4 analyticalHamiltonianGradient(vec4 x, vec4 p);
    vec4 renullMomentum(mat4 g_inv, vec4 p);
    vec4 catmullRomInterpolate(vec4 x0, vec4 x1, vec4 x2, vec4 x3, float t);
    float sampleVolume(in vec3 p, out vec3 c, out vec3 e);
    float sampleDisk(in vec3 p, out vec3 c, out vec3 e);

    void main() {
      vec2 uv = gl_FragCoord.xy / resolution;

      vec4 color = vec4(0.0);
      vec3 rayDirection = normalize(vDirection);
      vec3 rayPosition = cameraWorldPosition;
      vec3 relativeRayPosition = rayPosition - centerPosition;
      float rayCenterDistance = length(cross(rayDirection, relativeRayPosition));

      if (rayCenterDistance >= simulationRadius || (length(relativeRayPosition) >= simulationRadius && dot(rayDirection, -relativeRayPosition) <= 0.0)) {
        gl_FragColor = mix(texture(starMap,uv), vec4(color.rgb, 1.0), color.a);
      } else {
        float intersectionDistance = max(0.0, dot(rayDirection, -relativeRayPosition) - sqrt(simulationRadius * simulationRadius - rayCenterDistance * rayCenterDistance));
        vec3 intersectionPosition = relativeRayPosition + intersectionDistance * rayDirection;

        vec4 x = vec4(0, intersectionPosition);
        vec4 p = metric(x) * vec4(-1, rayDirection);
        p = 2.0 * normalize(renullMomentum(metricInverse(x), p));

        float minSpatialVelocity = 0.75;

        int i;
        vec4 prevX = x;
        vec4 prevP = p;

        for (i = 0; i < steps; i++) {
          vec4 prevPrevX = prevX;
          vec4 prevPrevP = prevP;
          stepRay(x, p, prevX, prevP, color, i);

          if (length((metricInverse(x) * p).yzw) < minSpatialVelocity) {
            break;
          } else if (length(x.yzw) > simulationRadius){
            vec3 lastStep = x.yzw - prevX.yzw;
            vec3 lastStepDirection = normalize(lastStep);

            float t = (dot(lastStepDirection, -prevX.yzw) + sqrt(simulationRadius * simulationRadius - dot(cross(lastStepDirection, -prevX.yzw), cross(lastStepDirection, -prevX.yzw)))) / length(lastStep);

            if (i == 0) {
                t = t * t * (2.0 - t);
            }

            float nextTimeStep = 0.1 * dot(x.yzw, x.yzw);
            vec4 nextP = p - nextTimeStep * analyticalHamiltonianGradient(x, p);
            vec4 nextX = x + nextTimeStep * metricInverse(x) * p;
            nextP = 2.0 * normalize(renullMomentum(metricInverse(nextX), nextP));

            x = catmullRomInterpolate(prevPrevX, prevX, x, nextX, t);
            p = catmullRomInterpolate(prevPrevP, prevP, p, nextP, t);

            break;
          }

          if (color.a > 0.995) {
            color /= color.a;
            break;
          }
        }

        rayDirection = (metricInverse(x) * p).yzw;

        vec3 dir = normalize(rayDirection);
        float theta = atan(dir.z, dir.x);
        float phi = asin(dir.y);

        vec2 distUv = vec2(theta / (2.0 * 3.14159265) + 0.5, phi / 3.14159265 + 0.5);
        vec4 temp = length((metricInverse(x) * p).yzw) < minSpatialVelocity || i == steps
          ? vec4(0.0, 0.0, 0.0, 1.0)
          : texture2D(starMap, distUv);

        vec4 finalColor = mix(temp, vec4(color.rgb, 1.0), color.a);

        gl_FragColor = finalColor;
      }
    }

    // does one step along the ray in the given direction, and if within the accretion disk, updates the color correspondingly
    void stepRay(inout vec4 x, inout vec4 p, inout vec4 prevX, inout vec4 prevP, inout vec4 color, in int i) {
      float timeStep = stepSize * (0.0125 / blackHoleMass) * dot(x.yzw, x.yzw);
      prevX = x;
      prevP = p;
      p -= timeStep*analyticalHamiltonianGradient(x, p);
      x += timeStep*metricInverse(x) * prevP;
      p = 2.0 * normalize(renullMomentum(metricInverse(x), p));
      // if within the bounding box (or rather, bounding hollow cylinder) of the accretion disk, samples its density at several substeps along the previous step.
      // the number of substeps is computed dynamically and depends on both the spatial length of the previous step and the number of steps so far.
      #ifdef ACCRETION_DISK_ENABLED
        float lastStepLength = length(x.yzw - prevX.yzw);
        if ((x.yzw.y * prevX.yzw.y < 0.0 || min(abs(x.yzw.y), abs(prevX.yzw.y)) < accretionDiskHeight) && max(dot(x.yzw.xz,x.yzw.xz), dot(prevX.yzw.xz,prevX.yzw.xz)) > innerAccretionDiskRadius * innerAccretionDiskRadius) {
          int subSteps = int(clamp(max(32.0, 64.0 - 8.0 * float(i)) * lastStepLength, 4.0, 32.0));
          float subStepWheight = 1.0 / float(subSteps);
          for (int j = 0; j < subSteps; j++) {
            float t = subStepWheight * float(j);
            vec3 pos = mix(prevX, x, t).yzw;
            if (length(pos.xz) > innerAccretionDiskRadius&&pos.y * pos.y < accretionDiskHeight) {
              vec3 volumeColor;
              vec3 volumeEmittance;
              float density = sampleDisk(pos, volumeColor, volumeEmittance);
              color += subStepWheight * 0.15 * lastStepLength * (1.0 - color.a) * (vec4(volumeEmittance,0) + density * vec4(volumeColor, 1));
            }
          }
        }
      #endif
    }

    // Kerr-Newman metric in Kerr-Schild coordinates, taken from https://michaelmoroz.github.io/TracingGeodesics/
    mat4 metric(vec4 x) {
      const float a = 0.0;
      float m = blackHoleMass;
      const float Q = 0.0;
      vec3 p = x.yzw;
      float rho = dot(p, p) - a * a;
      float r2 = 0.5 * (rho + sqrt(rho * rho + 4.0 * a * a * p.z * p.z));
      float r = sqrt(r2);
      vec4 k = vec4(1, (r * p.x + a * p.y) / (r2 + a * a), (r * p.y - a * p.x) / (r2 + a * a), p.z / r);
      float f = r2 * (2.0 * m * r - Q * Q) / (r2 * r2 + a * a * p.z * p.z);

      return f * mat4(k.x * k, k.y * k, k.z * k, k.w * k) + mat4(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    }

    // inverse of the the Kerr-Newman metric. equivalent to \`inverse(metric(x))\`, but computed using the Sherman–Morrison formula to avoid the costly call to \`inverse()\`
    mat4 metricInverse(vec4 x) {
      const float a = 0.0;
      float m = blackHoleMass;
      const float Q = 0.0;
      vec3 p = x.yzw;
      float rho = dot(p,p) - a * a;
      float r2 = 0.5 * (rho + sqrt(rho * rho + 4.0 * a * a * p.z * p.z));
      float r = sqrt(r2);
      vec4 k = vec4(1, (r * p.x + a * p.y) / (r2 + a * a), (r * p.y - a * p.x) / (r2 + a * a), p.z / r);
      float f = r2 * (2.0 * m * r - Q * Q) / (r2 * r2 + a * a * p.z * p.z);
      vec4 k2 = vec4(-k.x, k.yzw);

      return -1.0 / (1.0 / f + dot(k, k2)) * mat4(k2.x * k2, k2.y * k2, k2.z * k2, k2.w * k2) + mat4(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    }

    float hamiltonian(vec4 x, vec4 p){
      return 0.5 * dot(p, metricInverse(x) * p);
    }

    float lagrangian(vec4 x, vec4 dx){
      return 0.5 * dot(dx, metric(x) * dx);
    }

    // gradient of H in the first argument, computed numerically
    vec4 hamiltonianGradient(vec4 x, vec4 p){
      const float eps = 0.001;

      return (vec4(hamiltonian(x + vec4(eps, 0, 0, 0), p), hamiltonian(x + vec4(0, eps, 0, 0), p), hamiltonian(x + vec4(0, 0, eps, 0), p), hamiltonian(x + vec4(0, 0, 0, eps), p)) - hamiltonian(x, p)) / eps;
    }

    // gradient of H in the first argument, computed analytically
    vec4 analyticalHamiltonianGradient(vec4 x, vec4 p){
      const float a = 0.0;
      float m = blackHoleMass;
      const float Q = 0.0;
      vec3 pos = x.yzw;
      float rho = dot(pos,pos) - a*a;
      vec4 gradRho = 2.0*vec4(0,pos);
      float r2 = 0.5*(rho + sqrt(rho*rho + 4.0*a*a*pos.z*pos.z));
      vec4 gradR2 = 0.5*(gradRho+(rho*gradRho+4.0*a*a*pos.z*vec4(0,0,0,1))/sqrt(rho*rho+4.0*a*a*pos.z*pos.z));
      float r = sqrt(r2);
      vec4 gradR = gradR2/(2.0*r);
      vec4 k = vec4(1, (r*pos.x + a*pos.y)/(r2 + a*a), (r*pos.y - a*pos.x)/(r2 + a*a), pos.z/r);
      vec4 gradK1 = ((r2+a*a)*(gradR*pos.x+vec4(0,r,0,0)+vec4(0,0,a,0))-(r*pos.x+a*pos.y)*gradR2)/((r2+a*a)*(r2+a*a));
      vec4 gradK2 = ((r2+a*a)*(gradR*pos.y+vec4(0,0,r,0)-vec4(0,a,0,0))-(r*pos.y-a*pos.x)*gradR2)/((r2+a*a)*(r2+a*a));
      vec4 gradK3 = (r*vec4(0,0,0,1)-pos.z*gradR)/r2;
      mat4 jacobiTransposeK = mat4(vec4(0),gradK1,gradK2,gradK3);
      float f = r2*(2.0*m*r - Q*Q)/(r2*r2 + a*a*pos.z*pos.z);
      vec4 gradF = gradR2*(2.0*m*r-Q*Q)/(r2*r2+a*a*pos.z*pos.z)+r2*((r2*r2+a*a*pos.z*pos.z)*2.0*m*gradR-(2.0*m*r-Q*Q)*(2.0*r2*gradR2+a*a*pos.z*vec4(0,0,0,1)))/((r2*r2+a*a*pos.z*pos.z)*(r2*r2+a*a*pos.z*pos.z));
      vec4 k2 = vec4(-k.x,k.yzw);
      float f2 = -1.0/(1.0/f+dot(k,k2));
      vec4 gradF2 = (-gradF/(f*f)+jacobiTransposeK*(k+k2))/((1.0/f+dot(k,k2))*(1.0/f+dot(k,k2)));
      vec4 gradH = 0.5*(gradF2*dot(p,k2)*dot(p,k2)+2.0*f2*dot(p,k2)*jacobiTransposeK*p);

      return gradH;
    }

    vec4 renullMomentum(mat4 g_inv, vec4 p){
      float a = g_inv[0].x;
      vec3 b = g_inv[0].yzw;
      mat3 C = mat3(g_inv[1].yzw,g_inv[2].yzw,g_inv[3].yzw);
      float p2 = dot(b,p.yzw)/a;
      float q = dot(p.yzw,C*p.yzw)/a;
      float t = -p2+sqrt(p2*p2-q);

      return vec4(t,p.yzw);
    }

    // catmull-rom-interpolates between x1 and x2 with the parameter t.
    vec4 catmullRomInterpolate(vec4 x0, vec4 x1, vec4 x2, vec4 x3, float t){
      //mat4 C = mat4(1,-3,3,-1,0,3,-6,3,0,0,3,-3,0,0,0,1);
      //return dot(vec4(1,t,t*t,t*t*t),C*vec4(x1,x1+(x2-x0)/6.0,x2-(x3-x1)/6.0,x2));
      vec4 A = x1;
      vec4 B = x1+(x2-x0)/6.0;
      vec4 C = x2-(x3-x1)/6.0;
      vec4 D = x2;
      float t2 = 1.0-t;

      return A*t2*t2*t2+3.0*B*t2*t2*t+3.0*C*t2*t*t+D*t*t*t;
    }

    /* * * * * * * * * * * * * * * * * * * * * * * * * *
     * code defining the accretion disk, mostly        *
     * based on https://www.shadertoy.com/view/flcXW4  *
     * * * * * * * * * * * * * * * * * * * * * * * * * */

    float noise(vec3 p, int octave){
      vec3 f = fract(p);
      vec3 i = floor(p);
      vec3 s = smoothstep(0.0, 1.0, f);
      vec2 uv = (i.xy + s.xy + 0.5) / 64.0;

      return texture2D(noiseTexture, uv).x;
    }

    // taken from https://www.shadertoy.com/view/flcXW4, where it is cited with the following comment:
    // > idk what to cite, here are some shaders that all use this
    // > https://www.shadertoy.com/view/tsKczy
    // > https://www.shadertoy.com/view/MslSDl
    // > https://www.shadertoy.com/view/MttyzB
    vec3 blackbodyRGB(float t){
      // https://en.wikipedia.org/wiki/Planckian_locus
      float u = (0.860117757 + 1.54118254E-4 * t + 1.28641212E-7 * t * t) / (1.0 + 8.42420235E-4 * t + 7.08145163E-7 * t * t);
      float v = (0.317398726 + 4.22806245E-5 * t + 4.20481691E-8 * t * t) / (1.0 - 2.89741816E-5 * t + 1.61456053E-7 * t * t);

      // https://en.wikipedia.org/wiki/CIE_1960_color_space
      // https://en.wikipedia.org/wiki/XYZ_color_space

      // some weird color space -> xyz -> sRGB
      vec2 xyy = vec2(3.0 * u, 2.0 * v) / (2.0 * u - 8.0 * v + 4.0);
      vec3 xyz = vec3(xyy.x / xyy.y, 1.0, (1.0 - xyy.x - xyy.y) / xyy.y);
      vec3 rgb = xyz*mat3(3.240,-1.537,-0.499,-0.969,1.876,0.042,0.056,-0.204,1.057);

      return rgb;
    }

    vec2 rotate(vec2 vector, float theta) {
      float s = sin(theta), c = cos(theta);

      return vec2(vector.x * c - vector.y * s, vector.x * s + vector.y * c);
    }

    // Fractal Brownian Motion
    float fbm(vec3 p, int iter){
      float value = 0.0;
      float atten = 0.5;
      float scale = 1.0;
      for(int i = 0; i < iter; i++){
        value += atten * noise(scale*p,iter);
        atten *= 0.5;
        scale *= 2.5;
      }

      return value/(1.0-atten);
    }

    // taken from https://www.shadertoy.com/view/flcXW4
    float sampleVolume(in vec3 p, out vec3 c, out vec3 e) {
      c = vec3(0.3, 0.2, 0.1);
      e = vec3(0);

      if(dot(p.xz,p.xz)<innerAccretionDiskRadius*innerAccretionDiskRadius||dot(p.xz,p.xz)>outerAccretionDiskRadius*outerAccretionDiskRadius||p.y*p.y>accretionDiskHeight*accretionDiskHeight){
         return 0.0;
      }

      float n0 = fbm(10.0 * vec3(rotate( p.xz, 0.1*(8.0 * p.y) + 0.1*( 4.0 * length(p.xz) ) ), p.y).xzy, 2);

      float relativeR = (length(p.xz)-innerAccretionDiskRadius)/(outerAccretionDiskRadius-innerAccretionDiskRadius);
      float t = max(0.0,1.0-length(vec2(2.0*(relativeR*(2.0-relativeR))-1.0,p.y/accretionDiskHeight)));

      e = blackbodyRGB(500.0+3000.0*(1.0-relativeR)*(1.0-relativeR));
      e = clamp(e / max(max(max(e.r, e.g), e.b), 2.0), 0.0, 1.0);

      e *= 128.0 * max(t*n0*(1.0-relativeR)*max(1.0-1.5*relativeR,0.0), 0.0) / (dot(0.5*p,0.5*p) + 0.05);

      return 128.0 * max((t+0.1)*n0-0.1, 0.0);
    }

    float sampleDisk(vec3 pos, out vec3 volumeColor, out vec3 volumeEmittance) {
      // радиус в плоскости XZ
      float r = length(pos.xz);

      // координаты для шума (оставляем vec3 для fbm)
      // XZ берём из позиции, а в Y можно закодировать высоту или время (анимация)
      vec3 noisePos = vec3(pos.xz * 0.1, pos.y * 0.5);

      float density = fbm(noisePos, 2);

      // лёгкое затухание по высоте (имитация толщины диска)
      float heightFalloff = exp(-4.0 * abs(pos.y));
      density *= heightFalloff;

      // цветовая схема (пока статичная, потом можно параметризовать)
      volumeColor = vec3(1.0, 0.8, 0.5) * density;     // оранжевый газ
      volumeEmittance = vec3(1.0, 0.6, 0.2) * density; // свечение

      return density;
    }
  `
}
