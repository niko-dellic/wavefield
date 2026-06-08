/** Shader-native terminal contours built from field data instead of image luminance. */
export const TERMINAL_FRAGMENT: string = `
  float terminalGlyphShape(vec2 local, float brightness) {
    float horizontal = 1.0 - smoothstep(0.055, 0.28, abs(local.y));
    float vertical = 1.0 - smoothstep(0.055, 0.28, abs(local.x));
    float diagonalA = 1.0 - smoothstep(0.02, 0.18, abs(local.x + local.y));
    float diagonalB = 1.0 - smoothstep(0.02, 0.18, abs(local.x - local.y));
    float dotShape = 1.0 - smoothstep(0.08, 0.32, length(local));
    float sparse = mix(dotShape, max(horizontal, vertical) * 0.62, smoothstep(0.08, 0.34, brightness));
    float angled = max(diagonalA, diagonalB) * smoothstep(0.24, 0.72, brightness);
    return max(sparse, angled * 0.78);
  }

  vec3 applyTerminalOverlay(
    vec3 baseColor,
    vec2 uv,
    float normalizedField,
    float fieldGradient,
    float nodeBand,
    float broadBand,
    float density,
    float visibleInk,
    float nodeWidth
  ) {
    float amount = uTerminalParams.x;
    float strength = uTerminalStrength;
    if (amount <= 0.0001 || strength <= 0.0001 || visibleInk <= 0.0001) {
      return baseColor;
    }

    vec2 safeResolution = max(uResolution, vec2(1.0));
    vec2 cell = vec2(
      max(2.0, uTerminalParams.y * 0.58),
      max(2.0, uTerminalParams.y)
    );
    vec2 cellCount = safeResolution / cell;
    vec2 local = fract(uv * cellCount) - 0.5;

    float levels = max(1.0, uTerminalParams.z);
    float threshold = max(0.001, uTerminalParams.w);
    float contourPhase = abs(fract(abs(normalizedField) * levels) - 0.5);
    float fieldContour = 1.0 - smoothstep(0.045, 0.2, contourPhase);
    float edgeContour = smoothstep(
      threshold * 0.6,
      threshold + 0.22,
      fieldGradient * max(0.025, nodeWidth) * 0.95
    );
    float structuralMask = smoothstep(
      threshold * 0.35,
      threshold + 0.28,
      density + nodeBand * 0.52 + broadBand * 0.28
    );
    float contourMask =
      max(edgeContour, fieldContour * structuralMask) *
      visibleInk *
      clamp(strength, 0.0, 3.0);

    float glyph = terminalGlyphShape(local, clamp(density + nodeBand * 0.45, 0.0, 1.0));
    float glyphMask = clamp(glyph * contourMask, 0.0, 1.0);
    float cellRim = 1.0 - smoothstep(0.28, 0.5, max(abs(local.x), abs(local.y)));
    float scanline = 1.0 - smoothstep(0.045, 0.18, abs(local.y));
    float contourLine = clamp(
      max(fieldContour * structuralMask, edgeContour * 0.78) *
        visibleInk *
        strength *
        1.22,
      0.0,
      1.0
    );
    float localContrast = clamp(
      contourLine * (0.5 + cellRim * 0.22) +
        glyphMask * (0.34 + scanline * 0.26),
      0.0,
      0.86
    );
    vec3 localShadow = baseColor * (1.0 - localContrast);
    vec3 contourBlue = vec3(0.32, 0.68, 1.0);
    vec3 terminalHighlight = vec3(0.78, 0.96, 1.0);
    vec3 traced = mix(
      localShadow,
      contourBlue,
      clamp(contourLine * 0.62, 0.0, 0.84)
    );
    vec3 highlighted = mix(
      traced,
      terminalHighlight,
      clamp(glyphMask * (0.64 + density * 0.48), 0.0, 0.92)
    );

    return clamp(highlighted, 0.0, 1.0);
  }
`;
