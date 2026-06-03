import { Pane } from "tweakpane";

import type { CymaticSettings } from "../types";

export type ControlsManager = {
  dispose(): void;
  refresh(): void;
};

export function createControls(
  container: HTMLElement,
  settings: CymaticSettings,
  onChange: () => void,
): ControlsManager {
  let pane: Pane | null = null;
  let layoutKey = "";

  const build = () => {
    pane?.dispose();
    pane = new Pane({
      container,
      title: "Wavefield",
    });

    const engine = pane.addFolder({ title: "Engine", expanded: true });
    engine.addBinding(settings, "projectionMode", {
      label: "projection",
      options: {
        Screen: "screen",
        Sphere: "sphere",
      },
    });
    engine.addBinding(settings, "colorMode", {
      label: "color",
      options: {
        Chromesthesia: "chromesthesia",
        Mono: "mono",
        "Band split": "bandSplit",
        "Thermal phase": "thermalPhase",
      },
    });

    engine.addBinding(settings, "boundaryMode", {
      label: "boundary",
      options: {
        Neumann: "neumann",
        Dirichlet: "dirichlet",
      },
    });
    if (settings.projectionMode === "screen") {
      engine.addBinding(settings, "screenAspectMode", {
        label: "aspect",
        options: {
          Circle: "circle",
          "Viewport oval": "viewport",
        },
      });
    }
    engine.addBinding(settings, "modalCount", {
      label: "modes",
      min: 4,
      max: 32,
      step: 1,
    });
    engine.addBinding(settings, "modalDecay", {
      label: "modal decay",
      min: 0.12,
      max: 5,
      step: 0.01,
    });
    engine.addBinding(settings, "modalDrive", {
      label: "drive",
      min: 0,
      max: 3,
      step: 0.01,
    });
    engine.addBinding(settings, "sourceX", {
      label: "source x",
      min: 0.05,
      max: 0.95,
      step: 0.001,
    });
    engine.addBinding(settings, "sourceY", {
      label: "source y",
      min: 0.05,
      max: 0.95,
      step: 0.001,
    });
    if (settings.colorMode === "chromesthesia") {
      engine.addBinding(settings, "chromesthesiaMix", {
        label: "chroma mix",
        min: 0,
        max: 1,
        step: 0.01,
      });
    }

    if (settings.projectionMode === "sphere") {
      const sphere = pane.addFolder({ title: "Sphere", expanded: true });
      sphere.addBinding(settings, "sphereProjectionType", {
        label: "mapping",
        options: {
          Triplanar: "triplanar",
          UV: "uv",
        },
      });
      sphere.addBinding(settings, "sphereBackgroundTransparent", {
        label: "transparent bg",
      });
      sphere.addBinding(settings, "sphereSurfaceOpacity", {
        label: "surface alpha",
        min: 0.08,
        max: 1,
        step: 0.01,
      });
      sphere.addBinding(settings, "sphereRadius", {
        label: "size",
        min: 0.4,
        max: 2.4,
        step: 0.01,
      });
    }

    const shader = pane.addFolder({ title: "Shader", expanded: true });
    shader.addBinding(settings, "cymaticSymmetry", {
      label: "symmetry",
      min: 1,
      max: 16,
      step: 1,
    });
    shader.addBinding(settings, "cymaticHarmonicMix", {
      label: "harmonics",
      min: 0,
      max: 1,
      step: 0.01,
    });
    shader.addBinding(settings, "cymaticDensity", {
      label: "density",
      min: 0,
      max: 1.5,
      step: 0.01,
    });
    shader.addBinding(settings, "cymaticNodeWidth", {
      label: "node width",
      min: 0.005,
      max: 0.18,
      step: 0.001,
    });
    shader.addBinding(settings, "cymaticSoftness", {
      label: "softness",
      min: 0,
      max: 1,
      step: 0.01,
    });
    shader.addBinding(settings, "cymaticInterference", {
      label: "interference",
      min: 0,
      max: 1.5,
      step: 0.01,
    });
    shader.addBinding(settings, "cymaticEdgeFade", {
      label: "edge fade",
      min: 0,
      max: 1,
      step: 0.01,
    });
    shader.addBinding(settings, "cymaticWarp", {
      label: "warp",
      min: 0,
      max: 1.2,
      step: 0.01,
    });
    shader.addBinding(settings, "cymaticWarpScale", {
      label: "warp scale",
      min: 0,
      max: 2,
      step: 0.01,
    });
    shader.addBinding(settings, "cymaticDrift", {
      label: "drift",
      min: 0,
      max: 1,
      step: 0.01,
    });

    const audio = pane.addFolder({ title: "Audio", expanded: true });
    audio.addBinding(settings, "gain", {
      label: "gain",
      min: 0.1,
      max: 4,
      step: 0.01,
    });
    audio.addBinding(settings, "sensitivity", {
      label: "sensitivity",
      min: 0.05,
      max: 4,
      step: 0.01,
    });
    audio.addBinding(settings, "lowScale", {
      label: "low",
      min: 0,
      max: 3,
      step: 0.01,
    });
    audio.addBinding(settings, "midScale", {
      label: "mid",
      min: 0,
      max: 3,
      step: 0.01,
    });
    audio.addBinding(settings, "highScale", {
      label: "high",
      min: 0,
      max: 3,
      step: 0.01,
    });

    const post = pane.addFolder({ title: "Post", expanded: true });
    post.addBinding(settings, "postBloomEnabled", {
      label: "bloom",
    });
    if (settings.postBloomEnabled) {
      post.addBinding(settings, "postBloomIntensity", {
        label: "bloom power",
        min: 0,
        max: 3,
        step: 0.01,
      });
    }
    post.addBinding(settings, "postPixelationEnabled", {
      label: "pixelate",
    });
    if (settings.postPixelationEnabled) {
      post.addBinding(settings, "postPixelSize", {
        label: "pixel size",
        min: 2,
        max: 40,
        step: 1,
      });
    }
    post.addBinding(settings, "terminalContourEnabled", {
      label: "terminal",
    });
    if (settings.terminalContourEnabled) {
      post.addBinding(settings, "terminalCellSize", {
        label: "cell size",
        min: 4,
        max: 24,
        step: 1,
      });
      post.addBinding(settings, "terminalContourLevels", {
        label: "contours",
        min: 3,
        max: 18,
        step: 1,
      });
      post.addBinding(settings, "terminalContourStrength", {
        label: "line power",
        min: 0.2,
        max: 3,
        step: 0.01,
      });
      post.addBinding(settings, "terminalContourThreshold", {
        label: "threshold",
        min: 0.01,
        max: 0.35,
        step: 0.001,
      });
    }

    pane.on("change", onChange);
  };

  const refresh = () => {
    const nextLayoutKey = getLayoutKey(settings);
    if (!pane || nextLayoutKey !== layoutKey) {
      layoutKey = nextLayoutKey;
      build();
      return;
    }

    pane.refresh();
  };

  refresh();

  return {
    dispose() {
      pane?.dispose();
      pane = null;
    },
    refresh,
  };
}

function getLayoutKey(settings: CymaticSettings) {
  return [
    settings.projectionMode,
    settings.colorMode,
    settings.screenAspectMode,
    settings.postBloomEnabled,
    settings.postPixelationEnabled,
    settings.terminalContourEnabled,
  ].join(":");
}
