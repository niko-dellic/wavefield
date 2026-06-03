import * as THREE from "three";
import { Pass } from "postprocessing";

import type { AlphaDecayBlendMode, CymaticSettings } from "../types";

const BLEND_MODE_INDEX: Record<AlphaDecayBlendMode, number> = {
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

const VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const BLEND_FRAGMENT_SHADER = `
  uniform sampler2D inputBuffer;
  uniform sampler2D historyBuffer;
  uniform float decay;
  uniform int blendMode;
  uniform float hasHistory;
  varying vec2 vUv;

  vec3 blendOverlay(vec3 base, vec3 blend) {
    return mix(
      2.0 * base * blend,
      1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
      step(vec3(0.5), base)
    );
  }

  vec3 blendSoftLight(vec3 base, vec3 blend) {
    vec3 d = mix(
      ((16.0 * base - 12.0) * base + 4.0) * base,
      sqrt(max(base, vec3(0.0))),
      step(vec3(0.25), base)
    );
    return mix(
      base - (1.0 - 2.0 * blend) * base * (1.0 - base),
      base + (2.0 * blend - 1.0) * (d - base),
      step(vec3(0.5), blend)
    );
  }

  vec3 blendHardLight(vec3 base, vec3 blend) {
    return blendOverlay(blend, base);
  }

  float alphaDecayLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  vec3 blendColors(vec3 current, vec3 history) {
    if (blendMode == 0) {
      return mix(current, history, decay);
    } else if (blendMode == 1) {
      return 1.0 - (1.0 - current) * (1.0 - history * decay);
    } else if (blendMode == 2) {
      return mix(current, current * history, decay);
    } else if (blendMode == 3) {
      return mix(current, blendOverlay(current, history), decay);
    } else if (blendMode == 4) {
      return current + history * decay;
    } else if (blendMode == 5) {
      return current - history * decay;
    } else if (blendMode == 6) {
      return mix(current, min(current, history), decay);
    } else if (blendMode == 7) {
      return mix(current, max(current, history), decay);
    } else if (blendMode == 8) {
      return mix(current, abs(current - history), decay);
    } else if (blendMode == 9) {
      return mix(current, current + history - 2.0 * current * history, decay);
    } else if (blendMode == 10) {
      return mix(current, blendSoftLight(current, history), decay);
    } else if (blendMode == 11) {
      return mix(current, blendHardLight(current, history), decay);
    }
    return current;
  }

  void main() {
    vec4 current = texture2D(inputBuffer, vUv);
    vec4 history = texture2D(historyBuffer, vUv);
    if (hasHistory < 0.5) {
      gl_FragColor = current;
      return;
    }

    vec3 color = clamp(blendColors(current.rgb, history.rgb), 0.0, 1.0);
    float alpha = max(current.a, history.a * decay);
    float floorFade = smoothstep(0.006, 0.018, alphaDecayLuminance(color));
    color *= floorFade;
    alpha *= floorFade;
    gl_FragColor = vec4(color, alpha);
  }
`;

const COPY_FRAGMENT_SHADER = `
  uniform sampler2D inputBuffer;
  varying vec2 vUv;

  void main() {
    gl_FragColor = texture2D(inputBuffer, vUv);
  }
`;

function createRenderTarget(width = 1, height = 1) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.name = "AlphaDecayPass.History";
  target.texture.generateMipmaps = false;
  return target;
}

export class AlphaDecayPass extends Pass {
  private readonly blendMaterial: THREE.ShaderMaterial;
  private readonly copyMaterial: THREE.ShaderMaterial;
  private historyA = createRenderTarget();
  private historyB = createRenderTarget();
  private hasHistory = false;

  constructor() {
    super("AlphaDecayPass");
    this.needsSwap = true;

    this.blendMaterial = new THREE.ShaderMaterial({
      uniforms: {
        inputBuffer: { value: null },
        historyBuffer: { value: this.historyA.texture },
        decay: { value: this.getDecayForFrames(24) },
        blendMode: { value: BLEND_MODE_INDEX.screen },
        hasHistory: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: BLEND_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        inputBuffer: { value: null },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: COPY_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.fullscreenMaterial = this.blendMaterial;
  }

  updateSettings(settings: CymaticSettings) {
    this.blendMaterial.uniforms.decay.value = this.getDecayForFrames(
      settings.postAlphaDecayFrames,
    );
    this.blendMaterial.uniforms.blendMode.value =
      BLEND_MODE_INDEX[settings.postAlphaDecayBlendMode];
  }

  resetHistory() {
    this.hasHistory = false;
  }

  render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
  ) {
    if (!inputBuffer || !outputBuffer) {
      return;
    }

    this.fullscreenMaterial = this.blendMaterial;
    this.blendMaterial.uniforms.inputBuffer.value = inputBuffer.texture;
    this.blendMaterial.uniforms.historyBuffer.value = this.historyA.texture;
    this.blendMaterial.uniforms.hasHistory.value = this.hasHistory ? 1 : 0;
    renderer.setRenderTarget(outputBuffer);
    renderer.render(this.scene, this.camera);

    this.fullscreenMaterial = this.copyMaterial;
    this.copyMaterial.uniforms.inputBuffer.value = outputBuffer.texture;
    renderer.setRenderTarget(this.historyB);
    renderer.render(this.scene, this.camera);

    const previousHistory = this.historyA;
    this.historyA = this.historyB;
    this.historyB = previousHistory;
    this.hasHistory = true;

    if (this.renderToScreen) {
      this.copyMaterial.uniforms.inputBuffer.value = this.historyA.texture;
      renderer.setRenderTarget(null);
      renderer.render(this.scene, this.camera);
    }
  }

  setSize(width: number, height: number) {
    const targetWidth = Math.max(1, Math.floor(width));
    const targetHeight = Math.max(1, Math.floor(height));
    this.historyA.setSize(targetWidth, targetHeight);
    this.historyB.setSize(targetWidth, targetHeight);
    this.resetHistory();
  }

  dispose() {
    this.blendMaterial.dispose();
    this.copyMaterial.dispose();
    this.historyA.dispose();
    this.historyB.dispose();
    super.dispose();
  }

  private getDecayForFrames(frames: number) {
    return Math.pow(0.01, 1 / Math.max(1, frames));
  }
}
