import * as THREE from "three";

/**
 * Applies a validated CSS hex color as display-space RGB.
 *
 * Three.js color setters convert CSS colors into linear RGB by default. The
 * Wavefield shader writes colors directly, so UI swatches need to arrive as
 * their exact display RGB values to visually match the selected hex.
 */
export function setColorUniform(
  target: THREE.Color,
  color: string,
  fallback: number,
): void {
  const normalizedColor = /^#[\da-f]{6}$/i.test(color)
    ? color
    : `#${fallback.toString(16).padStart(6, "0")}`;
  const red = Number.parseInt(normalizedColor.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalizedColor.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalizedColor.slice(5, 7), 16) / 255;

  if (
    Number.isFinite(red) &&
    Number.isFinite(green) &&
    Number.isFinite(blue)
  ) {
    target.setRGB(red, green, blue, THREE.LinearSRGBColorSpace);
  } else {
    target.setRGB(0, 0, 0, THREE.LinearSRGBColorSpace);
  }
}
