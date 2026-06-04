import { Uniform, Vector2 } from "three";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";

import type { CymaticSettings } from "../types";

const FRAGMENT_SHADER = `
  uniform vec2 resolution;
  uniform float cellSize;
  uniform float contourLevels;
  uniform float contourStrength;
  uniform float contourThreshold;
  uniform float colorPreserve;
  uniform float amount;

  float luminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  float lineShape(vec2 local, float brightness) {
    float horizontal = 1.0 - smoothstep(0.055, 0.28, abs(local.y));
    float diagonalA = 1.0 - smoothstep(0.02, 0.18, abs(local.x + local.y));
    float diagonalB = 1.0 - smoothstep(0.02, 0.18, abs(local.x - local.y));
    float dotShape = 1.0 - smoothstep(0.08, 0.32, length(local));
    float sparse = mix(dotShape, horizontal, smoothstep(0.08, 0.36, brightness));
    float angled = max(diagonalA, diagonalB) * smoothstep(0.26, 0.72, brightness);
    return max(sparse, angled * 0.74);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 safeResolution = max(resolution, vec2(1.0));
    vec2 cell = vec2(max(2.0, cellSize * 0.58), max(2.0, cellSize));
    vec2 cellCount = safeResolution / cell;
    vec2 cellUv = (floor(uv * cellCount) + 0.5) / cellCount;
    vec2 texel = 1.0 / safeResolution;

    vec4 centerColor = texture2D(inputBuffer, cellUv);
    float centerLum = luminance(centerColor.rgb);
    float leftLum = luminance(texture2D(inputBuffer, cellUv - vec2(texel.x * cell.x, 0.0)).rgb);
    float rightLum = luminance(texture2D(inputBuffer, cellUv + vec2(texel.x * cell.x, 0.0)).rgb);
    float downLum = luminance(texture2D(inputBuffer, cellUv - vec2(0.0, texel.y * cell.y)).rgb);
    float upLum = luminance(texture2D(inputBuffer, cellUv + vec2(0.0, texel.y * cell.y)).rgb);
    float gradient = length(vec2(rightLum - leftLum, upLum - downLum));

    float contourPhase = abs(fract(centerLum * contourLevels) - 0.5);
    float contour = 1.0 - smoothstep(0.035, 0.18, contourPhase);
    float edge = smoothstep(contourThreshold, contourThreshold + 0.22, gradient * contourStrength);
    float mark = max(edge, contour * smoothstep(contourThreshold * 0.6, 0.86, centerLum));

    vec2 local = fract(uv * cellCount) - 0.5;
    float glyph = lineShape(local, centerLum) * mark;
    vec3 terminalColor = vec3(0.72, 0.94, 1.0) * glyph * (0.38 + centerLum * 1.55);
    vec3 base = inputColor.rgb * 0.2;
    vec3 terminalComposite = max(base, terminalColor);
    vec3 preservedColor = max(inputColor.rgb, terminalColor * 0.22);
    vec3 color = mix(terminalComposite, preservedColor, colorPreserve);

    outputColor = mix(inputColor, vec4(color, inputColor.a), amount);
  }
`;

export class TerminalContourEffect extends Effect {
  private readonly resolutionUniform: Uniform<Vector2>;
  private readonly cellSizeUniform: Uniform<number>;
  private readonly contourLevelsUniform: Uniform<number>;
  private readonly contourStrengthUniform: Uniform<number>;
  private readonly contourThresholdUniform: Uniform<number>;
  private readonly colorPreserveUniform: Uniform<number>;
  private readonly amountUniform: Uniform<number>;

  constructor() {
    const resolutionUniform = new Uniform(new Vector2(1, 1));
    const cellSizeUniform = new Uniform(9);
    const contourLevelsUniform = new Uniform(8);
    const contourStrengthUniform = new Uniform(1);
    const contourThresholdUniform = new Uniform(0.09);
    const colorPreserveUniform = new Uniform(0);
    const amountUniform = new Uniform(1);

    super("TerminalContourEffect", FRAGMENT_SHADER, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ["resolution", resolutionUniform],
        ["cellSize", cellSizeUniform],
        ["contourLevels", contourLevelsUniform],
        ["contourStrength", contourStrengthUniform],
        ["contourThreshold", contourThresholdUniform],
        ["colorPreserve", colorPreserveUniform],
        ["amount", amountUniform],
      ]),
    });

    this.resolutionUniform = resolutionUniform;
    this.cellSizeUniform = cellSizeUniform;
    this.contourLevelsUniform = contourLevelsUniform;
    this.contourStrengthUniform = contourStrengthUniform;
    this.contourThresholdUniform = contourThresholdUniform;
    this.colorPreserveUniform = colorPreserveUniform;
    this.amountUniform = amountUniform;
  }

  setSize(width: number, height: number) {
    this.resolutionUniform.value.set(width, height);
  }

  updateSettings(settings: CymaticSettings, amount = 1) {
    this.cellSizeUniform.value = settings.terminalCellSize;
    this.contourLevelsUniform.value = settings.terminalContourLevels;
    this.contourStrengthUniform.value = settings.terminalContourStrength;
    this.contourThresholdUniform.value = settings.terminalContourThreshold;
    this.colorPreserveUniform.value = settings.colorMode === "heatmap" ? 0.15 : 0;
    this.amountUniform.value = amount;
  }
}
