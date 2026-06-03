import { Pane } from "tweakpane";

import type { CymaticSettings, PostEffectId } from "../types";

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
    removePostStack(container);
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

    const bloom = pane.addFolder({ title: "Bloom", expanded: false });
    bloom.addBinding(settings, "postBloomEnabled", {
      label: "enabled",
    });
    if (settings.postBloomEnabled) {
      bloom.addBinding(settings, "postBloomIntensity", {
        label: "power",
        min: 0,
        max: 3,
        step: 0.01,
      });
    }

    const pixelation = pane.addFolder({ title: "Pixelation", expanded: false });
    pixelation.addBinding(settings, "postPixelationEnabled", {
      label: "enabled",
    });
    if (settings.postPixelationEnabled) {
      pixelation.addBinding(settings, "postPixelSize", {
        label: "pixel size",
        min: 2,
        max: 40,
        step: 1,
      });
    }

    const terminal = pane.addFolder({ title: "Terminal contours", expanded: false });
    terminal.addBinding(settings, "terminalContourEnabled", {
      label: "enabled",
    });
    if (settings.terminalContourEnabled) {
      terminal.addBinding(settings, "terminalCellSize", {
        label: "cell size",
        min: 4,
        max: 24,
        step: 1,
      });
      terminal.addBinding(settings, "terminalContourLevels", {
        label: "contours",
        min: 3,
        max: 18,
        step: 1,
      });
      terminal.addBinding(settings, "terminalContourStrength", {
        label: "line power",
        min: 0.2,
        max: 3,
        step: 0.01,
      });
      terminal.addBinding(settings, "terminalContourThreshold", {
        label: "threshold",
        min: 0.01,
        max: 0.35,
        step: 0.001,
      });
    }

    pane.on("change", onChange);
    mountPostStack(container, settings, onChange);
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
      removePostStack(container);
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
    settings.postEffectOrder.join(","),
  ].join(":");
}

const POST_EFFECT_LABELS: Record<PostEffectId, string> = {
  bloom: "Bloom",
  pixelation: "Pixelation",
  terminal: "Terminal contours",
};

function mountPostStack(
  container: HTMLElement,
  settings: CymaticSettings,
  onChange: () => void,
) {
  removePostStack(container);

  const root = document.createElement("section");
  root.className = "post-stack-control";
  root.setAttribute("aria-label", "Post processing order");
  root.innerHTML = `
    <div class="post-stack-heading">
      <span>Post order</span>
      <span class="post-stack-hint">drag</span>
    </div>
  `;

  let draggedId: PostEffectId | null = null;
  for (const effectId of settings.postEffectOrder) {
    const row = document.createElement("div");
    row.className = "post-stack-row";
    row.draggable = true;
    row.dataset.effectId = effectId;
    row.innerHTML = `
      <span class="post-stack-grip" aria-hidden="true">::</span>
      <span>${POST_EFFECT_LABELS[effectId]}</span>
      <span class="post-stack-state">${getEffectStateLabel(settings, effectId)}</span>
    `;

    row.addEventListener("dragstart", () => {
      draggedId = effectId;
      row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => {
      draggedId = null;
      row.classList.remove("is-dragging");
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!draggedId || draggedId === effectId) {
        return;
      }

      const nextOrder = settings.postEffectOrder.filter((id) => id !== draggedId);
      const targetIndex = nextOrder.indexOf(effectId);
      nextOrder.splice(Math.max(0, targetIndex), 0, draggedId);
      settings.postEffectOrder = nextOrder;
      onChange();
    });

    root.append(row);
  }

  container.append(root);
}

function removePostStack(container: HTMLElement) {
  container.querySelector(".post-stack-control")?.remove();
}

function getEffectStateLabel(settings: CymaticSettings, effectId: PostEffectId) {
  switch (effectId) {
    case "bloom":
      return settings.postBloomEnabled ? "on" : "off";
    case "pixelation":
      return settings.postPixelationEnabled ? "on" : "off";
    case "terminal":
      return settings.terminalContourEnabled ? "on" : "off";
  }
}
