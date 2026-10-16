export const sceneCloudDepthVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv=uv; gl_Position=vec4(position.xy,0.,1.); }
`
export const sceneCloudDepthFragment = /* glsl */ `
uniform sampler2D opaqueDepth;
uniform sampler2D waterDepth;
varying vec2 vUv;
void main() {
  gl_FragColor=vec4(min(texture2D(opaqueDepth,vUv).r,texture2D(waterDepth,vUv).r));
}
`
