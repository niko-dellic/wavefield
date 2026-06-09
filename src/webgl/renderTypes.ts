/** Transform applied to the screen-space field before shader sampling. */
export type ScreenViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  loopScale: number;
  loopOffsetX: number;
  loopOffsetY: number;
  loopBlend: number;
};
