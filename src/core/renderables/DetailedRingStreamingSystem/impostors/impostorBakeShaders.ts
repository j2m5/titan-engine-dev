export const impostorBakeVertex = /* glsl */`
precision highp float;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
in vec3 position;
in vec3 normal;
in vec4 surfaceData;
out vec3 vPosition;
out vec3 vNormal;
out vec2 vSurface;
void main() {
  vPosition = position;
  vNormal = normal;
  vSurface = surfaceData.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const impostorBakeFragment = /* glsl */`
precision highp float;
uniform vec3 captureDirection;
uniform float halfExtent;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vSurface;
layout(location = 0) out vec4 normalDepth;
layout(location = 1) out vec4 surfaceCoverage;
void main() {
  float depth = 0.5 + dot(vPosition, captureDirection) / (2.0 * halfExtent);
  normalDepth = vec4(normalize(vNormal) * 0.5 + 0.5, clamp(depth, 0.0, 1.0));
  surfaceCoverage = vec4(clamp(vSurface, 0.0, 1.0), 0.0, 1.0);
}
`

export const impostorMipVertex = /* glsl */`
precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position, 1.0); }
`

export const impostorMipFragment = /* glsl */`
precision highp float;
uniform sampler2D normalDepthMap;
uniform sampler2D surfaceCoverageMap;
uniform int sourceMip;
layout(location = 0) out vec4 normalDepth;
layout(location = 1) out vec4 surfaceCoverage;
vec4 averageBlock(sampler2D image, ivec2 p) {
  return 0.25 * (texelFetch(image, p, sourceMip) + texelFetch(image, p + ivec2(1, 0), sourceMip)
              + texelFetch(image, p + ivec2(0, 1), sourceMip) + texelFetch(image, p + ivec2(1, 1), sourceMip));
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  normalDepth = averageBlock(normalDepthMap, p);
  surfaceCoverage = averageBlock(surfaceCoverageMap, p);
}
`
