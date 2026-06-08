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
    if (amount <= 0.0001 || strength <= 0.0001) {
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
    float fieldSurface = clamp(
      max(visibleInk, broadBand * 0.62 + nodeBand * 0.36 + fieldContour * 0.12),
      0.0,
      1.0
    );
    float haloSurface = smoothstep(
      0.045,
      0.42,
      broadBand * 0.82 + density * 0.36 + nodeBand * 0.22
    );
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
      max(edgeContour * 0.78, fieldContour * max(structuralMask, haloSurface * 0.42)) *
      fieldSurface *
      clamp(strength, 0.0, 2.2);

    float glyph = terminalGlyphShape(local, clamp(density + nodeBand * 0.35 + haloSurface * 0.42, 0.0, 1.0));
    float cellEdge = smoothstep(0.38, 0.49, max(abs(local.x), abs(local.y)));
    float verticalStroke = 1.0 - smoothstep(0.035, 0.16, abs(local.x));
    float horizontalStroke = 1.0 - smoothstep(0.035, 0.16, abs(local.y));
    float terminalGrid = max(cellEdge * 0.72, max(verticalStroke, horizontalStroke) * 0.34);
    float gridMask = terminalGrid * haloSurface * fieldSurface;
    float glyphMask = clamp(max(glyph * contourMask, gridMask * 0.82 * strength), 0.0, 1.0);
    float cellRim = smoothstep(0.32, 0.5, max(abs(local.x), abs(local.y)));
    float scanline = 1.0 - smoothstep(0.035, 0.16, abs(local.y));
    float contourLine = clamp(
      max(fieldContour * structuralMask, edgeContour * 0.58) *
        fieldSurface *
        strength *
        0.82,
      0.0,
      0.78
    );
    float terminalMark = clamp(
      contourLine * (0.42 + cellRim * 0.24) +
        glyphMask * (0.82 + scanline * 0.24),
      0.0,
      1.0
    );
    vec3 localShadow = baseColor * (1.0 - terminalMark * 0.82);
    vec3 cyanAccent = vec3(0.12, 0.86, 0.92);
    vec3 orangeAccent = vec3(1.0, 0.42, 0.16);
    vec3 terminalAccent = mix(
      cyanAccent,
      orangeAccent,
      smoothstep(-0.18, 0.18, normalizedField)
    );
    vec3 colorTrace = mix(
      localShadow,
      terminalAccent,
      clamp(glyphMask * 0.58 + contourLine * 0.26, 0.0, 0.74)
    );
    vec3 traced = mix(
      colorTrace,
      vec3(0.0),
      clamp((1.0 - glyph) * contourLine * 0.28, 0.0, 0.32)
    );

    return clamp(traced, 0.0, 1.0);
  }
`;
