/** Color palette and line-intensity helpers used by all field models. */
export const COLOR_FRAGMENT: string = `  vec3 ramp4(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    float x = clamp(t, 0.0, 1.0);
    if (x < 0.33) {
      return mix(a, b, smoothstep(0.0, 0.33, x));
    }

    if (x < 0.68) {
      return mix(b, c, smoothstep(0.33, 0.68, x));
    }

    return mix(c, d, smoothstep(0.68, 1.0, x));
  }

  vec3 heatmapPalette(float heat) {
    float t = clamp(heat, 0.0, 1.0);
    if (uHeatmapPalette == 1) {
      return ramp4(
        t,
        vec3(0.025, 0.0, 0.0),
        vec3(0.58, 0.03, 0.0),
        vec3(1.0, 0.48, 0.05),
        vec3(1.0, 0.96, 0.72)
      );
    }

    if (uHeatmapPalette == 2) {
      return ramp4(
        t,
        vec3(0.28, 0.05, 0.58),
        vec3(0.05, 0.46, 0.92),
        vec3(0.08, 0.86, 0.42),
        vec3(1.0, 0.08, 0.02)
      );
    }

    return ramp4(
      t,
      vec3(0.02, 0.08, 0.42),
      vec3(0.0, 0.78, 0.92),
      vec3(1.0, 0.92, 0.18),
      vec3(1.0, 0.12, 0.02)
    );
  }

  float lineFeatherHeat(float fieldDistance, float nodeWidth, float featherScale, float haloHeat) {
    float lineDistance = fieldDistance / max(0.00001, nodeWidth);
    float featherDistance = clamp(lineDistance / max(1.0, featherScale), 0.0, 1.0);
    float heat = pow(1.0 - smoothstep(0.0, 1.0, featherDistance), 0.78);
    return clamp(max(heat, haloHeat), 0.0, 1.0);
  }

`;
