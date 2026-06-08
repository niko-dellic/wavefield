import { getPostEffectAmount } from "../effectiveSettings.ts";
import type {
  AlphaDecayBlendMode,
  CymaticSettings,
  EffectiveCymaticSettings,
  TerminalContourType,
} from "../types.ts";

const TERMINAL_TYPE_INDEX: Record<TerminalContourType, number> = {
  legacyBleed: 0,
  fieldGrid: 1,
};

const TERMINAL_BLEND_MODE_INDEX: Record<AlphaDecayBlendMode, number> = {
  normal: 0,
  screen: 1,
  multiply: 2,
  overlay: 3,
  add: 4,
  subtract: 5,
  darken: 6,
  lighten: 7,
  difference: 8,
  exclusion: 9,
  softLight: 10,
  hardLight: 11,
};

export type TerminalUniformState = {
  params: [
    amount: number,
    cellSize: number,
    contourLevels: number,
    contourThreshold: number,
  ];
  controls: [type: number, blendMode: number];
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
    controls: [
      TERMINAL_TYPE_INDEX[settings.terminalContourType],
      TERMINAL_BLEND_MODE_INDEX[settings.terminalContourBlendMode],
    ],
    strength: amount * settings.terminalContourStrength,
  };
}
