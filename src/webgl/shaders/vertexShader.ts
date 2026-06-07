/** Vertex shader for both screen and sphere proxy meshes. */
export const VERTEX_SHADER: string = `
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vLocalPosition = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
