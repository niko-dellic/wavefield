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
  let postPanes: Pane[] = [];
  let layoutKey = "";

  const build = () => {
    postPanes = removePostPanel(container, postPanes);
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
        "Free plate": "freePlate",
        Dirichlet: "dirichlet",
        Neumann: "neumann",
      },
    });
    if (settings.projectionMode === "screen") {
      engine.addBinding(settings, "screenAspectMode", {
        label: "aspect",
        options: {
          Circle: "circle",
          Fit: "fit",
        },
      });
    }
    engine.addBinding(settings, "modalCount", {
      label: "modes",
      min: 1,
      max: 12,
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
    engine.addBinding(settings, "patternHoldSeconds", {
      label: "pattern hold",
      min: 0,
      max: 3,
      step: 0.01,
    });
    engine.addBinding(settings, "morphSeconds", {
      label: "morph speed",
      min: 0.05,
      max: 2,
      step: 0.01,
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
        label: "transparent sphere",
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
    audio.addBinding(settings, "driveMode", {
      label: "drive mode",
      options: {
        Audio: "audio",
        Manual: "manual",
      },
    });
    if (settings.driveMode === "manual") {
      audio.addBinding(settings, "testFrequency", {
        label: "test Hz",
        min: 70,
        max: 7200,
        step: 1,
      });
      audio.addBinding(settings, "frequencySweep", {
        label: "sweep",
      });
      if (settings.frequencySweep) {
        audio.addBinding(settings, "frequencySweepRate", {
          label: "sweep rate",
          min: 0.02,
          max: 1.2,
          step: 0.01,
        });
      }
    }
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

    pane.on("change", onChange);
    postPanes = mountPostPanel(container, settings, onChange);
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
      postPanes = removePostPanel(container, postPanes);
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
    settings.driveMode,
    settings.frequencySweep,
    settings.postProcessingEnabled,
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

const POST_EFFECT_CONTROLS: Record<
  PostEffectId,
  Array<{
    key: keyof CymaticSettings;
    label: string;
    min: number;
    max: number;
    step: number;
  }>
> = {
  bloom: [
    {
      key: "postBloomIntensity",
      label: "Power",
      min: 0,
      max: 3,
      step: 0.01,
    },
  ],
  pixelation: [
    {
      key: "postPixelSize",
      label: "Pixel size",
      min: 2,
      max: 40,
      step: 1,
    },
  ],
  terminal: [
    {
      key: "terminalCellSize",
      label: "Cell size",
      min: 4,
      max: 24,
      step: 1,
    },
    {
      key: "terminalContourLevels",
      label: "Contours",
      min: 3,
      max: 18,
      step: 1,
    },
    {
      key: "terminalContourStrength",
      label: "Line power",
      min: 0.2,
      max: 3,
      step: 0.01,
    },
    {
      key: "terminalContourThreshold",
      label: "Threshold",
      min: 0.01,
      max: 0.35,
      step: 0.001,
    },
  ],
};

const POST_EFFECT_ENABLED_KEYS: Record<
  PostEffectId,
  "postBloomEnabled" | "postPixelationEnabled" | "terminalContourEnabled"
> = {
  bloom: "postBloomEnabled",
  pixelation: "postPixelationEnabled",
  terminal: "terminalContourEnabled",
};

function mountPostPanel(
  container: HTMLElement,
  settings: CymaticSettings,
  onChange: () => void,
): Pane[] {
  const postPanes: Pane[] = [];
  removePostPanel(container, postPanes);

  const root = document.createElement("section");
  root.className = "post-panel";
  root.setAttribute("aria-label", "Post processing controls");
  root.addEventListener("dragenter", stopInternalDrag);
  root.addEventListener("dragleave", stopInternalDrag);
  root.addEventListener("dragover", stopInternalDrag);
  root.addEventListener("drop", stopInternalDrag);

  const header = document.createElement("div");
  header.className = "post-panel-heading";
  header.append(
    createCheckbox({
      checked: settings.postProcessingEnabled,
      className: "post-panel-master",
      label: "Post processing",
      onChange: (checked) => {
        settings.postProcessingEnabled = checked;
        onChange();
      },
    }),
  );
  const hint = document.createElement("span");
  hint.className = "post-panel-hint";
  hint.textContent = "drag effects";
  header.append(hint);
  root.append(header);

  let draggedId: PostEffectId | null = null;
  let dropPlacement: "before" | "after" = "before";
  for (const effectId of settings.postEffectOrder) {
    const row = document.createElement("div");
    row.className = "post-effect-card";
    if (!settings.postProcessingEnabled) {
      row.classList.add("is-disabled");
    }
    row.dataset.effectId = effectId;

    const effectHeader = document.createElement("div");
    effectHeader.className = "post-effect-heading";
    const grip = document.createElement("span");
    grip.className = "post-effect-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.draggable = true;
    grip.textContent = "::";
    effectHeader.append(grip);
    effectHeader.append(
      createCheckbox({
        checked: Boolean(settings[POST_EFFECT_ENABLED_KEYS[effectId]]),
        disabled: !settings.postProcessingEnabled,
        label: POST_EFFECT_LABELS[effectId],
        onChange: (checked) => {
          settings[POST_EFFECT_ENABLED_KEYS[effectId]] = checked;
          onChange();
        },
      }),
    );
    row.append(effectHeader);

    if (settings[POST_EFFECT_ENABLED_KEYS[effectId]]) {
      const controls = document.createElement("div");
      controls.className = "post-effect-controls";
      const effectPane = new Pane({
        container: controls,
      });
      effectPane.element.classList.add("post-effect-pane");
      for (const control of POST_EFFECT_CONTROLS[effectId]) {
        effectPane.addBinding(settings, control.key, {
          disabled: !settings.postProcessingEnabled,
          label: control.label,
          max: control.max,
          min: control.min,
          step: control.step,
        });
      }
      effectPane.on("change", onChange);
      postPanes.push(effectPane);
      row.append(controls);
    }

    grip.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      draggedId = effectId;
      row.classList.add("is-dragging");
    });
    grip.addEventListener("dragend", (event) => {
      event.stopPropagation();
      draggedId = null;
      clearDropMarkers(root);
      row.classList.remove("is-dragging");
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!draggedId || draggedId === effectId) {
        clearDropMarkers(root);
        return;
      }

      const bounds = row.getBoundingClientRect();
      dropPlacement =
        event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      clearDropMarkers(root);
      row.classList.add(
        dropPlacement === "before" ? "is-drop-before" : "is-drop-after",
      );
    });
    row.addEventListener("dragleave", (event) => {
      event.stopPropagation();
      row.classList.remove("is-drop-before", "is-drop-after");
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!draggedId || draggedId === effectId) {
        clearDropMarkers(root);
        return;
      }

      const nextOrder = settings.postEffectOrder.filter((id) => id !== draggedId);
      const targetIndex = nextOrder.indexOf(effectId);
      const insertIndex = targetIndex + (dropPlacement === "after" ? 1 : 0);
      nextOrder.splice(Math.max(0, insertIndex), 0, draggedId);
      settings.postEffectOrder = nextOrder;
      clearDropMarkers(root);
      onChange();
    });

    root.append(row);
  }

  container.append(root);
  return postPanes;
}

function removePostPanel(container: HTMLElement, postPanes: Pane[]) {
  for (const postPane of postPanes) {
    postPane.dispose();
  }
  container.querySelector(".post-panel")?.remove();
  return [];
}

function stopInternalDrag(event: DragEvent) {
  event.stopPropagation();
}

function clearDropMarkers(root: HTMLElement) {
  root.querySelectorAll(".is-drop-before, .is-drop-after").forEach((element) => {
    element.classList.remove("is-drop-before", "is-drop-after");
  });
}

function createCheckbox({
  checked,
  className,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const wrapper = document.createElement("label");
  wrapper.className = ["post-checkbox", className].filter(Boolean).join(" ");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => {
    onChange(input.checked);
  });
  const text = document.createElement("span");
  text.textContent = label;
  wrapper.append(input, text);
  return wrapper;
}
