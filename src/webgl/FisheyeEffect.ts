import { Uniform, Vector2 } from "three";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";

import type { CymaticSettings } from "../types";

const FRAGMENT_SHADER = `
  uniform vec2 resolution;
  uniform float k1;
  uniform float k1Aspect;
  uniform float k2;
  uniform float k2Aspect;
  uniform float strength;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 safeResolution = max(resolution, vec2(1.0));
    float aspect = safeResolution.x / safeResolution.y;
    vec2 centered = uv - 0.5;
    vec2 circleRadial = vec2(centered.x * aspect, centered.y);
    float circleR2 = dot(circleRadial, circleRadial) * 4.0;
    float aspectR2 = dot(centered, centered) * 4.0;
    float k1R2 = mix(circleR2, aspectR2, k1Aspect);
    float k2R2 = mix(circleR2, aspectR2, k2Aspect);
    float scale = 1.0 + (k1 * k1R2 + k2 * k2R2 * k2R2) * strength;
    vec2 sampleUv = clamp(centered * scale + 0.5, vec2(0.0), vec2(1.0));

    outputColor = texture2D(inputBuffer, sampleUv);
    outputColor.a = inputColor.a;
  }
`;

export class FisheyeEffect extends Effect {
  private readonly resolutionUniform: Uniform<Vector2>;
  private readonly k1Uniform: Uniform<number>;
  private readonly k1AspectUniform: Uniform<number>;
  private readonly k2Uniform: Uniform<number>;
  private readonly k2AspectUniform: Uniform<number>;
  private readonly strengthUniform: Uniform<number>;

  constructor() {
    const resolutionUniform = new Uniform(new Vector2(1, 1));
    const k1Uniform = new Uniform(0.35);
    const k1AspectUniform = new Uniform(0);
    const k2Uniform = new Uniform(0.08);
    const k2AspectUniform = new Uniform(0);
    const strengthUniform = new Uniform(1);

    super("FisheyeEffect", FRAGMENT_SHADER, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ["resolution", resolutionUniform],
        ["k1", k1Uniform],
        ["k1Aspect", k1AspectUniform],
        ["k2", k2Uniform],
        ["k2Aspect", k2AspectUniform],
        ["strength", strengthUniform],
      ]),
    });

    this.resolutionUniform = resolutionUniform;
    this.k1Uniform = k1Uniform;
    this.k1AspectUniform = k1AspectUniform;
    this.k2Uniform = k2Uniform;
    this.k2AspectUniform = k2AspectUniform;
    this.strengthUniform = strengthUniform;
  }

  setSize(width: number, height: number) {
    this.resolutionUniform.value.set(width, height);
  }

  updateSettings(settings: CymaticSettings, amount = 1) {
    this.k1Uniform.value = settings.postFisheyeK1;
    this.k1AspectUniform.value = settings.postFisheyeK1Aspect ? 1 : 0;
    this.k2Uniform.value = settings.postFisheyeK2;
    this.k2AspectUniform.value = settings.postFisheyeK2Aspect ? 1 : 0;
    this.strengthUniform.value = settings.postFisheyeStrength * amount;
  }
}
