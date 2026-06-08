/** Fragment entrypoint that chooses screen or sphere rendering and emits final color. */
export const MAIN_FRAGMENT: string = `  void main() {
    if (uProjectionMode == 1 && uSphereFieldMode == 1 && uModeCount > 0) {
      gl_FragColor = renderSphereVolume();
      return;
    }

    if (uModeCount <= 0) {
      if (uIdlePreview < 0.5) {
        gl_FragColor = vec4(uBackgroundColor, 1.0);
        return;
      }

      vec2 p = screenFieldUv(vUv);
      float idleField = chladniValue(3.0, 5.0, p);
      float idleLine = 1.0 - smoothstep(0.008, 0.026, abs(idleField));
      vec3 idleColor = uBackgroundColor + vec3(0.08, 0.16, 0.2) * idleLine * 0.22;
      gl_FragColor = vec4(clamp(idleColor, 0.0, 1.0), 1.0);
      return;
    }

    FieldSample field = sampleProjectedField();
    float modeScale = sqrt(max(1.0, float(uModeCount)));
    float energyScale = uProjectionMode == 0
      ? max(0.22, modeScale * 0.18)
      : max(0.18, modeScale * 0.15);
    float normalizedField = field.field / energyScale;
    float audioPulse = clamp(
      uFeatureSignals.w * 0.88 + uFeatureSignals.z * 0.3 + uRms * 0.16,
      0.0,
      1.8
    );
    float nodeWidth = uProjectionMode == 0
      ? max(
          0.00042,
          uNodeWidth *
            0.035 *
            (0.85 + audioPulse * 0.3) *
            (
              uBoundaryWeights.x * 1.0 +
              uBoundaryWeights.y * 0.82 +
              uBoundaryWeights.z * 1.08 +
              uBoundaryWeights.w * 0.92 +
              uBoundaryClampedWeight * 0.76
            )
        )
      : max(0.00035, uNodeWidth * 0.055 * (0.82 + audioPulse * 0.34));
    float nodeBand = 1.0 - smoothstep(nodeWidth * 0.32, nodeWidth * 1.35, abs(normalizedField));
    float broadBand =
      1.0 - smoothstep(nodeWidth * 1.4, nodeWidth * (4.2 + uSoftness * 4.0), abs(normalizedField));
    float structure = smoothstep(0.02, 0.28 + uEdgeFade * 0.36, field.grad);
    float featherInk = uColorMode == 4
      ? broadBand * (0.2 + uSoftness * 0.38)
      : broadBand * uSoftness * 0.06;
    float density = clamp(
      (pow(nodeBand, 2.0) * 1.0 + featherInk)
        * (0.4 + structure * 0.6)
        * (0.66 + field.energy * (uProjectionMode == 0 ? 0.42 : 0.52))
        * uDensity
        * (0.92 + uFeatureSignals.y * 0.26 + audioPulse * 0.14),
      0.0,
      1.0
    );
    float halo = pow(clamp(1.0 - abs(normalizedField), 0.0, 1.0), 4.0) *
      uSoftness *
      field.energy *
      0.1;
    float visibleInk = uProjectionMode == 0
      ? smoothstep(0.005, 0.04, density + halo)
      : 1.0;
    if (uProjectionMode == 0 && visibleInk <= 0.001) {
      gl_FragColor = vec4(uBackgroundColor, 1.0);
      return;
    }
    float alpha = clamp((density + halo) * (0.96 + uRms * 0.22) * uOpacity, 0.0, 1.0);
    vec3 modalColor =
      field.colorWeight > 0.0001 ? field.color / field.colorWeight : vec3(0.86, 0.96, 1.0);
    vec3 monoColor = mix(uMonoColor * 0.5, mix(uMonoColor, vec3(1.0), 0.24), density);
    vec3 bandColor = normalize(uBandEnergies + vec3(0.02)) *
      vec3(0.38, 0.74, 0.96) +
      vec3(uBandEnergies.z * 0.9, uBandEnergies.y * 0.42, uBandEnergies.x * 0.32) +
      uChromaProfile.rgb * uChromaProfile.a * 0.22;
    vec3 thermalColor = mix(uThermalColdColor, uThermalHotColor, smoothstep(-0.35, 0.35, normalizedField));
    float haloHeat = clamp(halo * (3.0 + uSoftness * 3.0), 0.0, 0.2);
    float heat = lineFeatherHeat(
      abs(normalizedField),
      nodeWidth,
      4.2 + uSoftness * 4.0,
      haloHeat
    );
    vec3 heatmapColor = heatmapPalette(heat);
    vec3 color = monoColor;

    if (uColorMode == 0) {
      color = mix(monoColor, modalColor, clamp(uChromesthesiaMix, 0.0, 1.0));
    } else if (uColorMode == 2) {
      color = mix(monoColor, clamp(bandColor, 0.0, 1.0), 0.72);
    } else if (uColorMode == 3) {
      color = mix(monoColor, thermalColor, 0.78);
    } else if (uColorMode == 4) {
      color = heatmapColor;
    }

    color *=
      (0.82 + density * 0.72 + field.energy * 0.24 + audioPulse * 0.16) *
      visibleInk *
      uBrightness;
    vec3 litColor = clamp(color, 0.0, 1.0);
    if (uProjectionMode == 1 && uSphereTransparent > 0.5) {
      litColor = applyTerminalOverlay(
        litColor,
        vUv,
        normalizedField,
        field.grad,
        nodeBand,
        broadBand,
        density,
        visibleInk,
        nodeWidth
      );
      float outputAlpha = clamp(alpha * uSurfaceOpacity, 0.02, 1.0);
      gl_FragColor = vec4(clamp(litColor * alpha, 0.0, 1.0), outputAlpha);
      return;
    }
    vec3 finalColor = mix(uBackgroundColor, litColor, alpha);
    finalColor = applyTerminalOverlay(
      finalColor,
      vUv,
      normalizedField,
      field.grad,
      nodeBand,
      broadBand,
      density,
      visibleInk,
      nodeWidth
    );
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;
