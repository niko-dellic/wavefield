import { Pane, type FolderApi } from "tweakpane";

import {
  AUDIO_CONTROLS,
  ENGINE_CONTROLS,
  MONITOR_SIGNAL_OPTIONS,
  POST_EFFECT_CONTROLS,
  POST_EFFECT_LABELS,
  SETTING_DESCRIPTIONS,
  SHADER_CONTROLS,
  SPHERE_CONTROLS,
  type NumericControlConfig,
  type PostEffectControlConfig,
} from "../config/settings";
import type { CymaticSettings, PostEffectId } from "../types";

/** Live, read-only state surfaced by the Status monitor folder. */
export type MonitorState = {
  graph: number;
  reading: string;
  drive: string;
  peak: string;
  base: string;
  modes: string;
  topology: number;
  excitation: number;
  change: number;
  pulse: number;
};

// Maps each visible control label back to its settings key so we can attach
// hover tooltips after Tweakpane has rendered its rows.
const LABEL_TO_KEY = new Map<string, keyof CymaticSettings>();
for (const group of [
  ENGINE_CONTROLS,
  AUDIO_CONTROLS,
  SHADER_CONTROLS,
  SPHERE_CONTROLS,
]) {
  for (const control of Object.values(group)) {
    LABEL_TO_KEY.set(control.label, control.key);
  }
}
for (const controls of Object.values(POST_EFFECT_CONTROLS)) {
  for (const control of controls) {
    LABEL_TO_KEY.set(control.label, control.key);
  }
}
// Bindings whose label is defined inline (selects / toggles).
for (const [label, key] of [
  ["projection", "projectionMode"],
  ["color", "colorMode"],
  ["palette", "heatmapPalette"],
  ["mono", "monoColor"],
  ["cold", "thermalColdColor"],
  ["hot", "thermalHotColor"],
  ["boundary", "boundaryMode"],
  ["aspect", "screenAspectMode"],
  ["field", "sphereFieldMode"],
  ["mapping", "sphereProjectionType"],
  ["transparent sphere", "sphereBackgroundTransparent"],
  ["sweep", "frequencySweep"],
  ["monitor", "monitorSignal"],
] satisfies Array<[string, keyof CymaticSettings]>) {
  LABEL_TO_KEY.set(label, key);
}

const TOOLTIP_ATTR = "data-wf-tooltip";
const FOLDER_STATE_STORAGE_KEY = "wavefield:tweakpane-folder-state:v1";
let tooltipElement: HTMLElement | null = null;
let tooltipBound = false;

type FolderExpansionState = Record<string, boolean>;

function ensureTooltipElement() {
  if (!tooltipElement) {
    tooltipElement = document.createElement("div");
    tooltipElement.className = "wf-tooltip";
    tooltipElement.setAttribute("role", "tooltip");
    document.body.append(tooltipElement);
  }
  return tooltipElement;
}

function hideTooltip() {
  tooltipElement?.classList.remove("is-visible");
}

function showTooltip(row: HTMLElement) {
  const text = row.getAttribute(TOOLTIP_ATTR);
  if (!text) {
    return;
  }

  const tip = ensureTooltipElement();
  tip.textContent = text;
  const rowRect = row.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 12;
  // Prefer the left of the row (panels hug the right edge); fall back to the
  // right when there isn't room.
  let left = rowRect.left - tipRect.width - margin;
  if (left < 8) {
    left = Math.min(rowRect.right + margin, window.innerWidth - tipRect.width - 8);
  }
  const top = Math.max(
    8,
    Math.min(
      rowRect.top + rowRect.height / 2 - tipRect.height / 2,
      window.innerHeight - tipRect.height - 8,
    ),
  );
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
  tip.classList.add("is-visible");
}

// One delegated listener handles every current and future control row.
function bindTooltipDelegation() {
  if (tooltipBound) {
    return;
  }
  tooltipBound = true;

  document.addEventListener("pointerover", (event) => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      `[${TOOLTIP_ATTR}]`,
    );
    if (row) {
      showTooltip(row);
    }
  });
  document.addEventListener("pointerout", (event) => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      `[${TOOLTIP_ATTR}]`,
    );
    const related = event.relatedTarget as HTMLElement | null;
    if (row && !(related && row.contains(related))) {
      hideTooltip();
    }
  });
  document.addEventListener("pointerdown", hideTooltip);
  window.addEventListener("scroll", hideTooltip, true);
}

/** Attach styled hover tooltips to every Tweakpane row inside `root`. */
export function applyTooltipsByLabel(root: HTMLElement) {
  bindTooltipDelegation();
  for (const label of root.querySelectorAll<HTMLElement>(".tp-lblv_l")) {
    const key = LABEL_TO_KEY.get(label.textContent?.trim() ?? "");
    const description = key ? SETTING_DESCRIPTIONS[key] : undefined;
    if (description) {
      (label.closest<HTMLElement>(".tp-lblv") ?? label).setAttribute(
        TOOLTIP_ATTR,
        description,
      );
    }
  }
}

export type ControlsManager = {
  dispose(): void;
  refresh(): void;
};

export function createControls(
  container: HTMLElement,
  settings: CymaticSettings,
  onChange: () => void,
  monitorState: MonitorState,
): ControlsManager {
  let pane: Pane | null = null;
  let monitorPane: Pane | null = null;
  let postPanes: Pane[] = [];
  let layoutKey = "";
  const folderExpansionState = loadFolderExpansionState();
  const persistFolderExpansion = (id: string, expanded: boolean) => {
    folderExpansionState[id] = expanded;
    saveFolderExpansionState(folderExpansionState);
  };
  const addPersistentFolder = (
    parent: Pane | FolderApi,
    id: string,
    title: string,
    defaultExpanded = true,
  ) =>
    trackFolderExpansion(
      parent.addFolder({
        title,
        expanded: getStoredFolderExpansion(
          folderExpansionState,
          id,
          defaultExpanded,
        ),
      }),
      id,
      persistFolderExpansion,
    );

  const build = () => {
    postPanes = removePostPanel(container, postPanes);
    monitorPane?.dispose();
    monitorPane = null;
    pane?.dispose();
    pane = new Pane({
      container,
      expanded: getStoredFolderExpansion(
        folderExpansionState,
        "pane:Wavefield",
        true,
      ),
      title: "Wavefield",
    });
    trackFolderExpansion(pane, "pane:Wavefield", persistFolderExpansion);

    const engine = addPersistentFolder(pane, "folder:Engine", "Engine");
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
        Heatmap: "heatmap",
      },
    });
    if (settings.colorMode === "heatmap") {
      engine.addBinding(settings, "heatmapPalette", {
        label: "palette",
        options: {
          "Scientific heat": "scientificHeat",
          Blackbody: "blackbody",
          "Turbo-style": "turbo",
        },
      });
    } else if (settings.colorMode === "mono") {
      engine.addBinding(settings, "monoColor", {
        label: "mono",
      });
    } else if (settings.colorMode === "thermalPhase") {
      engine.addBinding(settings, "thermalColdColor", {
        label: "cold",
      });
      engine.addBinding(settings, "thermalHotColor", {
        label: "hot",
      });
    }

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
    const topology = addPersistentFolder(pane, "folder:Topology", "Topology");
    addNumericBinding(topology, settings, ENGINE_CONTROLS.modalCount);
    addNumericBinding(topology, settings, AUDIO_CONTROLS.sensitivity);
    addNumericBinding(topology, settings, ENGINE_CONTROLS.patternHoldSeconds);
    addNumericBinding(topology, settings, ENGINE_CONTROLS.morphSeconds);
    addNumericBinding(topology, settings, SHADER_CONTROLS.cymaticHarmonicMix);

    const excitation = addPersistentFolder(
      pane,
      "folder:Excitation",
      "Excitation",
    );
    addNumericBinding(excitation, settings, AUDIO_CONTROLS.gain);
    addNumericBinding(excitation, settings, AUDIO_CONTROLS.audioResponse);
    addNumericBinding(excitation, settings, ENGINE_CONTROLS.modalDrive);
    addNumericBinding(excitation, settings, ENGINE_CONTROLS.modalDecay);
    addNumericBinding(excitation, settings, AUDIO_CONTROLS.lowScale);
    addNumericBinding(excitation, settings, AUDIO_CONTROLS.midScale);
    addNumericBinding(excitation, settings, AUDIO_CONTROLS.highScale);

    if (settings.projectionMode === "sphere") {
      const sphere = addPersistentFolder(pane, "folder:Sphere", "Sphere");
      sphere.addBinding(settings, "sphereFieldMode", {
        label: "field",
        options: {
          Surface: "surface",
          Volume: "volume",
        },
      });
      if (settings.sphereFieldMode === "surface") {
        sphere.addBinding(settings, "sphereProjectionType", {
          label: "mapping",
          options: {
            Triplanar: "triplanar",
            UV: "uv",
          },
        });
      } else {
        addNumericBinding(sphere, settings, SPHERE_CONTROLS.sphereRaymarchSteps);
        addNumericBinding(sphere, settings, SPHERE_CONTROLS.sphereAbsorption);
        addNumericBinding(sphere, settings, SPHERE_CONTROLS.sphereShellBias);
        addNumericBinding(sphere, settings, SPHERE_CONTROLS.sphereInteriorGlow);
      }
      sphere.addBinding(settings, "sphereBackgroundTransparent", {
        label: "transparent sphere",
      });
      addNumericBinding(sphere, settings, SPHERE_CONTROLS.sphereSurfaceOpacity);
      addNumericBinding(sphere, settings, SPHERE_CONTROLS.sphereRadius);
    }

    const shader = addPersistentFolder(pane, "folder:Rendering", "Rendering");
    Object.values(SHADER_CONTROLS).forEach((control) => {
      if (control.key === "cymaticHarmonicMix") {
        return;
      }
      addNumericBinding(shader, settings, control);
    });
    if (settings.colorMode === "chromesthesia") {
      addNumericBinding(shader, settings, ENGINE_CONTROLS.chromesthesiaMix);
    }

    pane.on("change", onChange);

    // Live monitors live in their own pane: their 50ms ticks emit change events
    // that must NOT reach the input pane's change/refresh path (that recurses).
    monitorPane = new Pane({ container });
    const status = addPersistentFolder(monitorPane, "folder:Status", "Status");
    status.addBinding(monitorState, "drive", { readonly: true, label: "drive" });
    status.addBinding(monitorState, "peak", { readonly: true, label: "peak" });
    status.addBinding(monitorState, "base", { readonly: true, label: "base" });
    status.addBinding(monitorState, "modes", { readonly: true, label: "active modes" });
    const monitorBinding = status.addBinding(settings, "monitorSignal", {
      label: "monitor",
      options: MONITOR_SIGNAL_OPTIONS,
    });
    // Only the selector (an input) propagates; the readonly monitors below do not.
    monitorBinding.on("change", onChange);
    // Normalised 0..1 rolling graph of the selected live signal.
    status.addBinding(monitorState, "graph", {
      readonly: true,
      view: "graph",
      label: "graph",
      min: 0,
      max: 1,
      interval: 50,
    });
    // Real value (e.g. "440 Hz" or "0.42") of the selected signal.
    status.addBinding(monitorState, "reading", {
      readonly: true,
      label: "value",
      interval: 50,
    });
    const formatSignal = (value: number) => value.toFixed(2);
    status.addBinding(monitorState, "topology", {
      readonly: true,
      label: "topology",
      format: formatSignal,
    });
    status.addBinding(monitorState, "excitation", {
      readonly: true,
      label: "excitation",
      format: formatSignal,
    });
    status.addBinding(monitorState, "change", {
      readonly: true,
      label: "change",
      format: formatSignal,
    });
    status.addBinding(monitorState, "pulse", {
      readonly: true,
      label: "pulse",
      format: formatSignal,
    });

    postPanes = mountPostPanel(
      container,
      settings,
      onChange,
      folderExpansionState,
      persistFolderExpansion,
    );
    applyTooltipsByLabel(container);
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
      monitorPane?.dispose();
      monitorPane = null;
      pane?.dispose();
      pane = null;
    },
    refresh,
  };
}

function getLayoutKey(settings: CymaticSettings) {
  return [
    settings.projectionMode,
    settings.sphereFieldMode,
    settings.colorMode,
    settings.screenAspectMode,
    settings.postProcessingEnabled,
    settings.postBloomEnabled,
    settings.postPixelationEnabled,
    settings.postFisheyeEnabled,
    settings.postAlphaDecayEnabled,
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

function getStoredFolderExpansion(
  state: FolderExpansionState,
  id: string,
  defaultExpanded: boolean,
) {
  return state[id] ?? defaultExpanded;
}

function trackFolderExpansion<T extends FolderApi>(
  folder: T,
  id: string,
  onFold: (id: string, expanded: boolean) => void,
) {
  folder.on("fold", (event) => {
    onFold(id, event.expanded);
  });
  return folder;
}

function loadFolderExpansionState(): FolderExpansionState {
  try {
    const rawState = window.localStorage.getItem(FOLDER_STATE_STORAGE_KEY);
    if (!rawState) {
      return {};
    }

    const parsedState = JSON.parse(rawState) as unknown;
    if (!parsedState || typeof parsedState !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsedState).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

function saveFolderExpansionState(state: FolderExpansionState) {
  try {
    window.localStorage.setItem(FOLDER_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Folder state persistence is a convenience; private browsing/storage
    // failures should never break the controls.
  }
}

const POST_EFFECT_ENABLED_KEYS: Record<
  PostEffectId,
  | "postBloomEnabled"
  | "postPixelationEnabled"
  | "postFisheyeEnabled"
  | "postAlphaDecayEnabled"
  | "terminalContourEnabled"
> = {
  bloom: "postBloomEnabled",
  pixelation: "postPixelationEnabled",
  fisheye: "postFisheyeEnabled",
  alphaDecay: "postAlphaDecayEnabled",
  terminal: "terminalContourEnabled",
};

function isNumericControl(
  control: PostEffectControlConfig,
): control is NumericControlConfig {
  return "min" in control;
}

function mountPostPanel(
  container: HTMLElement,
  settings: CymaticSettings,
  onChange: () => void,
  folderExpansionState: FolderExpansionState,
  persistFolderExpansion: (id: string, expanded: boolean) => void,
): Pane[] {
  const postPanes: Pane[] = [];
  removePostPanel(container, postPanes);

  const postPane = new Pane({ container });
  postPane.element.classList.add("post-panel-pane");

  const postFolder = postPane.addFolder({
    title: "Post processing",
    expanded: getStoredFolderExpansion(
      folderExpansionState,
      "folder:Post processing",
      true,
    ),
  });
  trackFolderExpansion(
    postFolder,
    "folder:Post processing",
    persistFolderExpansion,
  );
  postFolder.element.classList.add("post-panel-folder");

  const root = document.createElement("div");
  root.className = "post-panel";
  root.setAttribute("aria-label", "Post processing controls");
  root.addEventListener("dragenter", stopInternalDrag);
  root.addEventListener("dragleave", stopInternalDrag);
  root.addEventListener("dragover", stopInternalDrag);
  root.addEventListener("drop", stopInternalDrag);

  const toolbar = document.createElement("div");
  toolbar.className = "post-panel-toolbar";
  toolbar.append(
    createCheckbox({
      checked: settings.postProcessingEnabled,
      className: "post-panel-master",
      label: "Enabled",
      onChange: (checked) => {
        settings.postProcessingEnabled = checked;
        onChange();
      },
    }),
  );
  const hint = document.createElement("span");
  hint.className = "post-panel-hint";
  hint.textContent = "drag effects";
  toolbar.append(hint);
  root.append(toolbar);

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
        if (isNumericControl(control)) {
          effectPane.addBinding(settings, control.key, {
            disabled: !settings.postProcessingEnabled,
            label: control.label,
            max: control.max,
            min: control.min,
            step: control.step,
          });
        } else {
          effectPane.addBinding(settings, control.key, {
            disabled: !settings.postProcessingEnabled,
            label: control.label,
            options: control.options,
          });
        }
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

  const folderContent =
    postFolder.element.querySelector<HTMLElement>(":scope > .tp-fldv_c") ??
    postFolder.element;
  folderContent.append(root);
  postPanes.push(postPane);
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
