import { Uniform, Vector2 } from "three";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";

import type { CymaticSettings } from "../types";

const FRAGMENT_SHADER = `
  uniform vec2 resolution;
  uniform float k1;
  uniform float k2;
  uniform float strength;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 safeResolution = max(resolution, vec2(1.0));
    float aspect = safeResolution.x / safeResolution.y;
    vec2 centered = uv - 0.5;
    vec2 radial = vec2(centered.x * aspect, centered.y);
    float r2 = dot(radial, radial) * 4.0;
    float scale = 1.0 + (k1 * r2 + k2 * r2 * r2) * strength;
    vec2 sampleUv = clamp(centered * scale + 0.5, vec2(0.0), vec2(1.0));

    outputColor = texture2D(inputBuffer, sampleUv);
    outputColor.a = inputColor.a;
  }
`;

export class FisheyeEffect extends Effect {
  private readonly resolutionUniform: Uniform<Vector2>;
  private readonly k1Uniform: Uniform<number>;
  private readonly k2Uniform: Uniform<number>;
  private readonly strengthUniform: Uniform<number>;

  constructor() {
    const resolutionUniform = new Uniform(new Vector2(1, 1));
    const k1Uniform = new Uniform(0.35);
    const k2Uniform = new Uniform(0.08);
    const strengthUniform = new Uniform(1);

    super("FisheyeEffect", FRAGMENT_SHADER, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ["resolution", resolutionUniform],
        ["k1", k1Uniform],
        ["k2", k2Uniform],
        ["strength", strengthUniform],
      ]),
    });

    this.resolutionUniform = resolutionUniform;
    this.k1Uniform = k1Uniform;
    this.k2Uniform = k2Uniform;
    this.strengthUniform = strengthUniform;
  }

  setSize(width: number, height: number) {
    this.resolutionUniform.value.set(width, height);
  }

  updateSettings(settings: CymaticSettings) {
    this.k1Uniform.value = settings.postFisheyeK1;
    this.k2Uniform.value = settings.postFisheyeK2;
    this.strengthUniform.value = settings.postFisheyeStrength;
  }
}
