import { getPostEffectAmount } from "../effectiveSettings.ts";
import type { CymaticSettings, EffectiveCymaticSettings } from "../types.ts";

export type FisheyeUniformState = {
  params: [k1: number, k1Aspect: number, k2: number, k2Aspect: number];
  strength: number;
};

/** Derives shader-native fisheye uniforms from settings and transition amounts. */
export function getFisheyeUniformState(
  settings: CymaticSettings | EffectiveCymaticSettings,
): FisheyeUniformState {
  return {
    params: [
      settings.postFisheyeK1,
      settings.postFisheyeK1Aspect ? 1 : 0,
      settings.postFisheyeK2,
      settings.postFisheyeK2Aspect ? 1 : 0,
    ],
    strength:
      settings.postFisheyeStrength * getPostEffectAmount(settings, "fisheye"),
  };
}
