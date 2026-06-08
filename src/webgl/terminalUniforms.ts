import { getPostEffectAmount } from "../effectiveSettings.ts";
import type { CymaticSettings, EffectiveCymaticSettings } from "../types.ts";

export type TerminalUniformState = {
  params: [
    amount: number,
    cellSize: number,
    contourLevels: number,
    contourThreshold: number,
  ];
  strength: number;
};

/** Derives shader-native terminal contour uniforms from settings and transition amounts. */
export function getTerminalUniformState(
  settings: CymaticSettings | EffectiveCymaticSettings,
  displayPixelRatio = 1,
): TerminalUniformState {
  const amount = getPostEffectAmount(settings, "terminal");
  const safeDisplayPixelRatio =
    Number.isFinite(displayPixelRatio) && displayPixelRatio > 0
      ? displayPixelRatio
      : 1;
  return {
    params: [
      amount,
      settings.terminalCellSize * safeDisplayPixelRatio,
      settings.terminalContourLevels,
      settings.terminalContourThreshold,
    ],
    strength: amount * settings.terminalContourStrength,
  };
}
