import { Pane, type FolderApi } from "tweakpane";

import {
  AUDIO_CONTROLS,
  ENGINE_CONTROLS,
  POST_EFFECT_CONTROLS,
  POST_EFFECT_LABELS,
  SHADER_CONTROLS,
  SPHERE_CONTROLS,
  type NumericControlConfig,
} from "../config/settings";
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
    addNumericBinding(engine, settings, ENGINE_CONTROLS.modalCount);
    addNumericBinding(engine, settings, ENGINE_CONTROLS.modalDecay);
    addNumericBinding(engine, settings, ENGINE_CONTROLS.modalDrive);
    addNumericBinding(engine, settings, ENGINE_CONTROLS.patternHoldSeconds);
    addNumericBinding(engine, settings, ENGINE_CONTROLS.morphSeconds);
    if (settings.colorMode === "chromesthesia") {
      addNumericBinding(engine, settings, ENGINE_CONTROLS.chromesthesiaMix);
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
      addNumericBinding(sphere, settings, SPHERE_CONTROLS.sphereSurfaceOpacity);
      addNumericBinding(sphere, settings, SPHERE_CONTROLS.sphereRadius);
    }

    const shader = pane.addFolder({ title: "Shader", expanded: true });
    Object.values(SHADER_CONTROLS).forEach((control) => {
      addNumericBinding(shader, settings, control);
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
      addNumericBinding(audio, settings, AUDIO_CONTROLS.testFrequency);
      audio.addBinding(settings, "frequencySweep", {
        label: "sweep",
      });
      if (settings.frequencySweep) {
        addNumericBinding(audio, settings, AUDIO_CONTROLS.frequencySweepRate);
      }
    }
    addNumericBinding(audio, settings, AUDIO_CONTROLS.gain);
    addNumericBinding(audio, settings, AUDIO_CONTROLS.sensitivity);
    addNumericBinding(audio, settings, AUDIO_CONTROLS.lowScale);
    addNumericBinding(audio, settings, AUDIO_CONTROLS.midScale);
    addNumericBinding(audio, settings, AUDIO_CONTROLS.highScale);

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
    settings.postFisheyeEnabled,
    settings.terminalContourEnabled,
    settings.postEffectOrder.join(","),
  ].join(":");
}

function addNumericBinding(
  pane: Pane | FolderApi,
  settings: CymaticSettings,
  control: NumericControlConfig,
) {
  pane.addBinding(settings, control.key, {
    label: control.label,
    min: control.min,
    max: control.max,
    step: control.step,
  });
}

const POST_EFFECT_ENABLED_KEYS: Record<
  PostEffectId,
  | "postBloomEnabled"
  | "postPixelationEnabled"
  | "postFisheyeEnabled"
  | "terminalContourEnabled"
> = {
  bloom: "postBloomEnabled",
  pixelation: "postPixelationEnabled",
  fisheye: "postFisheyeEnabled",
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
