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

  vec3 terminalBlendOverlay(vec3 base, vec3 layer) {
    return mix(
      2.0 * base * layer,
      1.0 - 2.0 * (1.0 - base) * (1.0 - layer),
      step(vec3(0.5), base)
    );
  }

  vec3 terminalBlendSoftLight(vec3 base, vec3 layer) {
    vec3 d = mix(
      ((16.0 * base - 12.0) * base + 4.0) * base,
      sqrt(max(base, vec3(0.0))),
      step(vec3(0.25), base)
    );
    return mix(
      base - (1.0 - 2.0 * layer) * base * (1.0 - base),
      base + (2.0 * layer - 1.0) * (d - base),
      step(vec3(0.5), layer)
    );
  }

  vec3 terminalBlendColors(vec3 base, vec3 layer, float opacity, float blendMode) {
    vec3 blended = layer;
    if (blendMode < 0.5) {
      blended = layer;
    } else if (blendMode < 1.5) {
      blended = 1.0 - (1.0 - base) * (1.0 - layer);
    } else if (blendMode < 2.5) {
      blended = base * layer;
    } else if (blendMode < 3.5) {
      blended = terminalBlendOverlay(base, layer);
    } else if (blendMode < 4.5) {
      blended = base + layer;
    } else if (blendMode < 5.5) {
      blended = base - layer;
    } else if (blendMode < 6.5) {
      blended = min(base, layer);
    } else if (blendMode < 7.5) {
      blended = max(base, layer);
    } else if (blendMode < 8.5) {
      blended = abs(base - layer);
    } else if (blendMode < 9.5) {
      blended = base + layer - 2.0 * base * layer;
    } else if (blendMode < 10.5) {
      blended = terminalBlendSoftLight(base, layer);
    } else {
      blended = terminalBlendOverlay(layer, base);
    }
    return mix(base, clamp(blended, 0.0, 1.0), clamp(opacity, 0.0, 1.0));
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
    float contourType = uTerminalControls.x;
    float blendMode = uTerminalControls.y;
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
    float fieldGlyphMask = clamp(max(glyph * contourMask, gridMask * 0.82 * strength), 0.0, 1.0);
    float cellRim = smoothstep(0.32, 0.5, max(abs(local.x), abs(local.y)));
    float scanline = 1.0 - smoothstep(0.035, 0.16, abs(local.y));
    float fieldContourLine = clamp(
      max(fieldContour * structuralMask, edgeContour * 0.58) *
        fieldSurface *
        strength *
        0.82,
      0.0,
      0.78
    );
    float fieldMark = clamp(
      fieldContourLine * (0.42 + cellRim * 0.24) +
        fieldGlyphMask * (0.82 + scanline * 0.24),
      0.0,
      1.0
    );
    float legacySurface = clamp(
      visibleInk + broadBand * 1.15 + nodeBand * 0.22 + fieldContour * 0.2,
      0.0,
      1.0
    );
    float legacyBleed = smoothstep(
      0.015,
      0.34,
      broadBand * 1.2 + density * 0.24 + fieldContour * 0.18
    );
    float legacyScan = 1.0 - smoothstep(0.02, 0.13, abs(local.y));
    float legacyColumn = 1.0 - smoothstep(0.018, 0.1, abs(local.x));
    float legacyGlyph = max(glyph, max(legacyScan, legacyColumn) * 0.44);
    float legacyMark = clamp(
      legacyGlyph *
        legacyBleed *
        legacySurface *
        strength *
        (0.42 + fieldContour * 0.55 + edgeContour * 0.24),
      0.0,
      1.0
    );
    float terminalMark = contourType < 0.5 ? legacyMark : fieldMark;
    float terminalLine = contourType < 0.5 ? fieldContour * legacyBleed : fieldContourLine;
    float terminalGlyph = contourType < 0.5 ? legacyGlyph : glyph;
    vec3 cyanAccent = vec3(0.12, 0.86, 0.92);
    vec3 orangeAccent = vec3(1.0, 0.42, 0.16);
    vec3 terminalAccent = mix(
      cyanAccent,
      orangeAccent,
      smoothstep(-0.18, 0.18, normalizedField)
    );
    vec3 inkLayer = mix(
      vec3(0.02, 0.025, 0.028),
      terminalAccent,
      clamp(terminalGlyph * 0.62 + terminalLine * 0.32, 0.0, 0.86)
    );
    float opacity = clamp(terminalMark * amount, 0.0, 1.0);
    vec3 blended = terminalBlendColors(
      baseColor,
      inkLayer,
      opacity,
      blendMode
    );

    return clamp(blended, 0.0, 1.0);
  }
`;
