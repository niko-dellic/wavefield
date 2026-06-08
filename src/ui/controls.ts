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
  type BooleanControlConfig,
  type NumericControlConfig,
  type PostEffectControlConfig,
  type SelectControlConfig,
} from "../config/settings";
import {
  createTemplateApplyCommandId,
  formatKeyBinding,
  type KeyBindingMap,
} from "../keybindings";
import type { WavefieldTemplate } from "../templateSettings";
import type {
  TemplateTransitionConfig,
  TemplateTransitionEasing,
} from "../templateTransition";
import type {
  BoundaryMode,
  CymaticSettings,
  FieldModel,
  PostEffectId,
} from "../types";
import type { ScreenViewPosition } from "./screenViewController";
import type { WanderConfig } from "../wander";

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

export type SettingsChangeOptions = {
  refreshControls?: boolean;
  source?: "color";
  editing?: boolean;
};

type ColorSettingKey =
  | "backgroundColor"
  | "monoColor"
  | "thermalColdColor"
  | "thermalHotColor";

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
  ["model", "fieldModel"],
  ["color", "colorMode"],
  ["palette", "heatmapPalette"],
  ["background", "backgroundColor"],
  ["mono", "monoColor"],
  ["cold", "thermalColdColor"],
  ["hot", "thermalHotColor"],
  ["resonance", "boundaryMode"],
  ["aspect", "screenAspectMode"],
  ["field", "sphereFieldMode"],
  ["mapping", "sphereProjectionType"],
  ["transparent sphere", "sphereBackgroundTransparent"],
  ["sweep", "frequencySweep"],
  ["monitor", "monitorSignal"],
] satisfies Array<[string, keyof CymaticSettings]>) {
  LABEL_TO_KEY.set(label, key);
}

const LABEL_DESCRIPTIONS = new Map<string, string>([
  [
    "morph",
    "Smooth direct resonance changes instead of snapping immediately to the new resonance shape.",
  ],
  [
    "duration",
    "How long a direct resonance morph takes to blend from the current shape to the new one.",
  ],
  [
    "easing",
    "The timing curve used during direct resonance morphs.",
  ],
  [
    "apply resonance",
    "Allow templates to change the current resonance type during template transitions.",
  ],
  [
    "pan wander",
    "Slowly drifts the screen canvas when you are not interacting.",
  ],
  [
    "depth wander",
    "Slowly eases the screen canvas in and out when you are not interacting.",
  ],
  ["wander", "Enable autonomous screen movement."],
  [
    "rotate wander",
    "Slowly rotates the screen canvas when you are not interacting.",
  ],
  [
    "resume delay",
    "Seconds to wait before wandering resumes after manual canvas movement.",
  ],
  ["pan speed", "Speed multiplier for autonomous screen drift."],
  ["depth speed", "Speed multiplier for autonomous zoom drift."],
  ["rotate speed", "Speed multiplier for autonomous screen rotation."],
  ["min depth", "Smallest zoom scale the depth wander can reach."],
  ["max depth", "Largest zoom scale the depth wander can reach."],
  [
    "pan damping",
    "Input pan easing. Lower values glide longer; higher values stop sooner.",
  ],
  [
    "zoom damping",
    "Input zoom easing. Lower values glide longer; higher values stop sooner.",
  ],
  ["x", "Horizontal screen canvas offset."],
  ["y", "Vertical screen canvas offset."],
  ["z", "Screen canvas scale/depth."],
  ["rotation", "Drag a unit point around the fixed origin to set rotation."],
]);

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
    const labelText = label.textContent?.trim() ?? "";
    const key = LABEL_TO_KEY.get(labelText);
    const description = key ? SETTING_DESCRIPTIONS[key] : undefined;
    const labelDescription = description ?? LABEL_DESCRIPTIONS.get(labelText);
    if (labelDescription) {
      (label.closest<HTMLElement>(".tp-lblv") ?? label).setAttribute(
        TOOLTIP_ATTR,
        labelDescription,
      );
    }
  }
}

export type ControlsManager = {
  dispose(): void;
  refresh(): void;
};

export type TemplateControlsOptions = {
  isDev: boolean;
  saveState: {
    name: string;
  };
  keyBindings: KeyBindingMap;
  capturingKeybindSlug: string | null;
  activeTemplateSlug: string | null;
  templates: WavefieldTemplate[];
  onApplyTemplate: (template: WavefieldTemplate) => void;
  onDeleteTemplate: (template: WavefieldTemplate) => void | Promise<void>;
  onResaveTemplate: (template: WavefieldTemplate) => void | Promise<void>;
  onSaveTemplate: (name: string) => void | Promise<void>;
  onStartTemplateKeyCapture: (template: WavefieldTemplate) => void;
};

type TemplateControlsSource =
  | TemplateControlsOptions
  | (() => TemplateControlsOptions);

export type TransitionControlsConfig = TemplateTransitionConfig & {
  enabled: boolean;
};

export type TransitionControlsOptions = {
  config: TransitionControlsConfig;
  onChange: (config: TransitionControlsConfig) => void;
};

export type WanderControlsOptions = {
  config: WanderConfig;
  onChange: (config: WanderConfig) => void;
  getPosition: () => ScreenViewPosition;
  onPositionChange: (position: ScreenViewPosition) => void;
};

export function createControls(
  container: HTMLElement,
  settings: CymaticSettings,
  onChange: (options?: SettingsChangeOptions) => void,
  monitorState: MonitorState,
  templateControls?: TemplateControlsSource,
  transitionControls?: TransitionControlsOptions,
  wanderControls?: WanderControlsOptions,
  onBoundaryModeChange?: (boundaryMode: BoundaryMode) => void,
  onFieldModelChange?: (fieldModel: FieldModel) => void,
): ControlsManager {
  let pane: Pane | null = null;
  let monitorPane: Pane | null = null;
  let postPanes: Pane[] = [];
  let layoutKey = "";
  let ignoredPaneChangeTargets = new Set<unknown>();
  let colorPaneChangeTargets = new Set<unknown>();
  let syncColorControlState: (() => void) | null = null;
  let syncLiveControlState: (() => void) | null = null;
  let isRefreshingLiveControlState = false;
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
    ignoredPaneChangeTargets = new Set<unknown>();
    colorPaneChangeTargets = new Set<unknown>();
    syncColorControlState = null;
    syncLiveControlState = null;
    isRefreshingLiveControlState = false;
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
    const fieldModelBinding = engine.addBinding(settings, "fieldModel", {
      label: "model",
      options: {
        "Modal Plate": "modalPlate",
        "Radial Plate": "radialPlate",
        "Faraday Pulse": "faradayPulse",
        "Spiral Phase": "spiralPhase",
      },
    });
    if (onFieldModelChange) {
      ignoredPaneChangeTargets.add(fieldModelBinding);
      fieldModelBinding.on("change", (event) => {
        onFieldModelChange(event.value as FieldModel);
      });
    }
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
      addColorBinding(
        engine,
        settings,
        "monoColor",
        "mono",
        colorPaneChangeTargets,
      );
    } else if (settings.colorMode === "thermalPhase") {
      addColorBinding(
        engine,
        settings,
        "thermalColdColor",
        "cold",
        colorPaneChangeTargets,
      );
      addColorBinding(
        engine,
        settings,
        "thermalHotColor",
        "hot",
        colorPaneChangeTargets,
      );
    }

    const boundaryModeBinding = engine.addBinding(settings, "boundaryMode", {
      label: "resonance",
      options: {
        "Free Plate": "freePlate",
        Pinned: "dirichlet",
        "Open Edge": "neumann",
        Clamped: "clamped",
        Supported: "supported",
      },
    });
    if (onBoundaryModeChange) {
      ignoredPaneChangeTargets.add(boundaryModeBinding);
      boundaryModeBinding.on("change", (event) => {
        onBoundaryModeChange(event.value as BoundaryMode);
      });
    }
    if (settings.projectionMode === "screen") {
      engine.addBinding(settings, "screenAspectMode", {
        label: "aspect",
        options: {
          Circle: "circle",
          Fit: "fit",
        },
      });
    }

    if (transitionControls) {
      const transitionState = {
        morph: transitionControls.config.enabled,
        duration: transitionControls.config.durationSeconds,
        easing: transitionControls.config.easing,
        applyResonance: transitionControls.config.applyBoundaryMode,
      };
      const syncTransitionConfig = () => {
        transitionControls.onChange({
          enabled: transitionState.morph,
          durationSeconds: transitionState.duration,
          easing: transitionState.easing,
          applyBoundaryMode: transitionState.applyResonance,
        });
      };
      const transition = addPersistentFolder(
        pane,
        "folder:Transition",
        "Transition",
      );
      const morphBinding = transition.addBinding(transitionState, "morph", {
        label: "morph",
      });
      const durationBinding = transition.addBinding(
        transitionState,
        "duration",
        {
          label: "duration",
          min: 0,
          max: 12,
          step: 0.05,
        },
      );
      const easingBinding = transition.addBinding(transitionState, "easing", {
        label: "easing",
        options: getTransitionEasingOptions(),
      });
      const applyResonanceBinding = transition.addBinding(
        transitionState,
        "applyResonance",
        {
          label: "apply resonance",
        },
      );
      const transitionBindings = [
        morphBinding,
        durationBinding,
        easingBinding,
        applyResonanceBinding,
      ];
      for (const binding of transitionBindings) {
        ignoredPaneChangeTargets.add(binding);
        binding.on("change", syncTransitionConfig);
      }
    }

    if (wanderControls && settings.projectionMode === "screen") {
      const positionState = wanderControls.getPosition();
      const wanderState = {
        enabled: wanderControls.config.enabled,
        panWander: wanderControls.config.panEnabled,
        panSpeed: wanderControls.config.panSpeed,
        depthWander: wanderControls.config.depthEnabled,
        depthSpeed: wanderControls.config.depthSpeed,
        minDepth: wanderControls.config.minDepth,
        maxDepth: wanderControls.config.maxDepth,
        rotateWander: wanderControls.config.rotateEnabled,
        rotateSpeed: wanderControls.config.rotateSpeed,
        resumeDelay: wanderControls.config.resumeDelaySeconds,
        panDamping: wanderControls.config.panDamping,
        zoomDamping: wanderControls.config.zoomDamping,
        x: positionState.x,
        y: positionState.y,
        z: positionState.z,
        rotation: radiansToRotationPoint(positionState.rotation),
      };
      syncLiveControlState = () => {
        const position = wanderControls.getPosition();
        wanderState.x = position.x;
        wanderState.y = position.y;
        wanderState.z = position.z;
        const rotationPoint = radiansToRotationPoint(position.rotation);
        wanderState.rotation.x = rotationPoint.x;
        wanderState.rotation.y = rotationPoint.y;
      };
      const syncWanderConfig = () => {
        if (isRefreshingLiveControlState) {
          return;
        }

        wanderControls.onChange({
          enabled: wanderState.enabled,
          panEnabled: wanderState.panWander,
          panSpeed: wanderState.panSpeed,
          depthEnabled: wanderState.depthWander,
          depthSpeed: wanderState.depthSpeed,
          minDepth: wanderState.minDepth,
          maxDepth: wanderState.maxDepth,
          rotateEnabled: wanderState.rotateWander,
          rotateSpeed: wanderState.rotateSpeed,
          resumeDelaySeconds: wanderState.resumeDelay,
          panDamping: wanderState.panDamping,
          zoomDamping: wanderState.zoomDamping,
        });
      };
      const syncWanderPosition = () => {
        if (isRefreshingLiveControlState) {
          return;
        }

        const rotation = rotationPointToRadians(
          wanderState.rotation,
          wanderControls.getPosition().rotation,
        );
        const rotationPoint = radiansToRotationPoint(rotation);
        wanderState.rotation.x = rotationPoint.x;
        wanderState.rotation.y = rotationPoint.y;
        wanderControls.onPositionChange({
          x: wanderState.x,
          y: wanderState.y,
          z: wanderState.z,
          rotation,
        });
      };
      const controls = addPersistentFolder(
        pane,
        "folder:Controls",
        "Controls",
      );
      const controlBindings = [
        controls.addBinding(wanderState, "panDamping", {
          label: "pan damping",
          min: 0.1,
          max: 30,
          step: 0.1,
        }),
        controls.addBinding(wanderState, "zoomDamping", {
          label: "zoom damping",
          min: 0.1,
          max: 30,
          step: 0.1,
        }),
      ];
      for (const binding of controlBindings) {
        ignoredPaneChangeTargets.add(binding);
        binding.on("change", syncWanderConfig);
      }
      const positionBindings = [
        controls.addBinding(wanderState, "x", {
          label: "x",
          step: 0.001,
        }),
        controls.addBinding(wanderState, "y", {
          label: "y",
          step: 0.001,
        }),
        controls.addBinding(wanderState, "z", {
          label: "z",
          min: 0.05,
          max: 16,
          step: 0.001,
        }),
        controls.addBinding(wanderState, "rotation", {
          label: "rotation",
          x: { min: -1, max: 1, step: 0.001 },
          y: { min: -1, max: 1, step: 0.001, inverted: true },
          picker: "inline",
          expanded: false,
        }),
      ];
      for (const binding of positionBindings) {
        ignoredPaneChangeTargets.add(binding);
        binding.on("change", syncWanderPosition);
      }

      const wander = addPersistentFolder(
        controls,
        "folder:Controls/Wander",
        "Wander",
      );
      const enabledBinding = wander.addBinding(wanderState, "enabled", {
        label: "wander",
      });
      ignoredPaneChangeTargets.add(enabledBinding);
      enabledBinding.on("change", syncWanderConfig);

      if (wanderState.enabled) {
        const configBindings = [
          wander.addBinding(wanderState, "panWander", { label: "pan wander" }),
          wander.addBinding(wanderState, "panSpeed", {
            label: "pan speed",
            min: 0,
            max: 10,
            step: 0.01,
          }),
          wander.addBinding(wanderState, "depthWander", {
            label: "depth wander",
          }),
          wander.addBinding(wanderState, "depthSpeed", {
            label: "depth speed",
            min: 0,
            max: 10,
            step: 0.01,
          }),
          wander.addBinding(wanderState, "minDepth", {
            label: "min depth",
            min: 0.05,
            max: 16,
            step: 0.01,
          }),
          wander.addBinding(wanderState, "maxDepth", {
            label: "max depth",
            min: 0.05,
            max: 16,
            step: 0.01,
          }),
          wander.addBinding(wanderState, "rotateWander", {
            label: "rotate wander",
          }),
          wander.addBinding(wanderState, "rotateSpeed", {
            label: "rotate speed",
            min: 0,
            max: 10,
            step: 0.01,
          }),
          wander.addBinding(wanderState, "resumeDelay", {
            label: "resume delay",
            min: 0,
            max: 10,
            step: 0.1,
          }),
        ];
        for (const binding of configBindings) {
          ignoredPaneChangeTargets.add(binding);
          binding.on("change", syncWanderConfig);
        }
      }
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
    addColorBinding(
      shader,
      settings,
      "backgroundColor",
      "background",
      colorPaneChangeTargets,
    );
    Object.values(SHADER_CONTROLS).forEach((control) => {
      if (control.key === "cymaticHarmonicMix") {
        return;
      }
      addNumericBinding(shader, settings, control);
    });
    if (settings.colorMode === "chromesthesia") {
      addNumericBinding(shader, settings, ENGINE_CONTROLS.chromesthesiaMix);
    }

    const currentTemplateControls = resolveTemplateControls(templateControls);
    if (currentTemplateControls) {
      mountTemplatePanel(
        pane,
        currentTemplateControls,
        folderExpansionState,
        persistFolderExpansion,
      );
    }

    pane.on("change", (event) => {
      if (colorPaneChangeTargets.has(event.target)) {
        onChange({
          editing: !event.last,
          refreshControls: false,
          source: "color",
        });
        return;
      }

      if (ignoredPaneChangeTargets.has(event.target)) {
        return;
      }
      onChange();
    });

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
    monitorBinding.on("change", () => onChange());
    // Normalised 0..1 rolling graph of the selected live signal.
    status.addBinding(monitorState, "graph", {
      readonly: true,
      view: "graph",
      label: "graph",
      min: 0,
      max: 1,
      interval: 100,
    });
    // Real value (e.g. "440 Hz" or "0.42") of the selected signal.
    status.addBinding(monitorState, "reading", {
      readonly: true,
      label: "value",
      interval: 100,
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
    const nextLayoutKey = getLayoutKey(
      settings,
      resolveTemplateControls(templateControls),
      wanderControls?.config.enabled,
    );
    if (!pane || nextLayoutKey !== layoutKey) {
      layoutKey = nextLayoutKey;
      build();
      return;
    }

    isRefreshingLiveControlState = true;
    try {
      syncLiveControlState?.();
      syncColorControlState?.();
      pane.refresh();
    } finally {
      isRefreshingLiveControlState = false;
    }
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

function getLayoutKey(
  settings: CymaticSettings,
  templateControls?: TemplateControlsOptions,
  wanderEnabled = false,
) {
  return [
    settings.projectionMode,
    settings.sphereFieldMode,
    settings.colorMode,
    settings.screenAspectMode,
    settings.postProcessingEnabled,
    settings.postEffectOrder.join(","),
    settings.postBloomEnabled ? "bloom:on" : "bloom:off",
    settings.postPixelationEnabled ? "pixelation:on" : "pixelation:off",
    settings.postFisheyeEnabled ? "fisheye:on" : "fisheye:off",
    settings.terminalContourEnabled ? "terminal:on" : "terminal:off",
    settings.postAlphaDecayEnabled ? "alphaDecay:on" : "alphaDecay:off",
    `wander:${wanderEnabled ? "on" : "off"}`,
    getTemplateLayoutKey(templateControls),
  ].join(":");
}

function getTemplateLayoutKey(templateControls?: TemplateControlsOptions) {
  if (!templateControls) {
    return "templates:none";
  }

  return [
    templateControls.isDev ? "dev" : "prod",
    templateControls.capturingKeybindSlug ?? "",
    templateControls.activeTemplateSlug ?? "",
    JSON.stringify(templateControls.keyBindings),
    ...templateControls.templates.map(
      (template) => `${template.slug}/${template.name}/${template.createdAt}`,
    ),
  ].join(",");
}

function resolveTemplateControls(templateControls?: TemplateControlsSource) {
  return typeof templateControls === "function"
    ? templateControls()
    : templateControls;
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

function addColorBinding(
  pane: Pane | FolderApi,
  settings: CymaticSettings,
  key: ColorSettingKey,
  label: string,
  colorPaneChangeTargets: Set<unknown>,
) {
  settings[key] = normalizeColorHex(settings[key]);
  const binding = pane.addBinding(settings, key, { label });
  colorPaneChangeTargets.add(binding);
}

function normalizeColorHex(color: string) {
  return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : "#000000";
}

function mountTemplatePanel(
  pane: Pane,
  templateControls: TemplateControlsOptions,
  folderExpansionState: FolderExpansionState,
  persistFolderExpansion: (id: string, expanded: boolean) => void,
) {
  const folder = trackFolderExpansion(
    pane.addFolder({
      title: "Templates",
      expanded: getStoredFolderExpansion(
        folderExpansionState,
        "folder:Templates",
        true,
      ),
    }),
    "folder:Templates",
    persistFolderExpansion,
  );
  folder.element.classList.add("template-panel-folder");

  const root = document.createElement("div");
  root.className = "template-panel";
  root.setAttribute("aria-label", "Templates");

  if (templateControls.isDev) {
    root.append(createTemplateSavePanel(templateControls));
  }

  const list = document.createElement("div");
  list.className = "template-list";
  if (templateControls.templates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "template-empty";
    empty.textContent = "No templates";
    list.append(empty);
  } else {
    for (const template of templateControls.templates) {
      list.append(createTemplateRow(template, templateControls));
    }
  }
  root.append(list);

  const folderContent =
    folder.element.querySelector<HTMLElement>(":scope > .tp-fldv_c") ??
    folder.element;
  folderContent.append(root);
}

function createTemplateSavePanel(templateControls: TemplateControlsOptions) {
  const savePanel = document.createElement("div");
  savePanel.className = "template-save-panel";

  const input = document.createElement("input");
  input.className = "template-name-input";
  input.type = "text";
  input.placeholder = "Name";
  input.value = templateControls.saveState.name;
  input.setAttribute("aria-label", "Template name");

  const saveButton = document.createElement("button");
  saveButton.className = "template-save-button";
  saveButton.type = "button";
  saveButton.title = "Save template";
  saveButton.setAttribute("aria-label", "Save template");
  saveButton.innerHTML = `<i class="ph ph-floppy-disk" aria-hidden="true"></i>`;

  const syncSaveState = () => {
    templateControls.saveState.name = input.value;
    saveButton.disabled = input.value.trim().length === 0;
  };
  input.addEventListener("input", syncSaveState);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || saveButton.disabled) {
      return;
    }

    event.preventDefault();
    runTemplateAction(saveButton, () =>
      templateControls.onSaveTemplate(input.value),
    );
  });
  saveButton.addEventListener("click", () => {
    runTemplateAction(saveButton, () =>
      templateControls.onSaveTemplate(input.value),
    );
  });
  syncSaveState();

  savePanel.append(input, saveButton);
  return savePanel;
}

function createTemplateRow(
  template: WavefieldTemplate,
  templateControls: TemplateControlsOptions,
) {
  const row = document.createElement("div");
  row.className = "template-row";
  if (templateControls.isDev) {
    row.classList.add("has-dev-actions");
  }

  const applyButton = document.createElement("button");
  applyButton.className = "template-apply-button";
  applyButton.type = "button";
  applyButton.textContent = template.name;
  applyButton.title = `Apply ${template.name}`;
  if (templateControls.activeTemplateSlug === template.slug) {
    applyButton.classList.add("active");
    applyButton.setAttribute("aria-current", "true");
  }
  applyButton.addEventListener("click", () => {
    templateControls.onApplyTemplate(template);
  });
  row.append(applyButton);

  const keybindButton = document.createElement("button");
  keybindButton.className = "template-keybind-button";
  keybindButton.type = "button";
  const commandId = createTemplateApplyCommandId(template.slug);
  const isCapturing = templateControls.capturingKeybindSlug === template.slug;
  keybindButton.textContent = isCapturing
    ? "..."
    : formatKeyBinding(templateControls.keyBindings[commandId]);
  keybindButton.title = `Set keybind for ${template.name}`;
  keybindButton.setAttribute("aria-label", `Set keybind for ${template.name}`);
  keybindButton.addEventListener("click", () => {
    templateControls.onStartTemplateKeyCapture(template);
  });
  row.append(keybindButton);

  if (templateControls.isDev) {
    const resaveButton = document.createElement("button");
    resaveButton.className = "template-resave-button";
    resaveButton.type = "button";
    resaveButton.title = `Resave ${template.name}`;
    resaveButton.setAttribute("aria-label", `Resave ${template.name}`);
    resaveButton.innerHTML = `<i class="ph ph-arrow-clockwise" aria-hidden="true"></i>`;
    resaveButton.addEventListener("click", () => {
      runTemplateAction(resaveButton, () =>
        templateControls.onResaveTemplate(template),
      );
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "template-delete-button";
    deleteButton.type = "button";
    deleteButton.title = `Delete ${template.name}`;
    deleteButton.setAttribute("aria-label", `Delete ${template.name}`);
    deleteButton.innerHTML = `<i class="ph ph-trash" aria-hidden="true"></i>`;
    deleteButton.addEventListener("click", () => {
      runTemplateAction(deleteButton, () =>
        templateControls.onDeleteTemplate(template),
      );
    });
    row.append(resaveButton);
    row.append(deleteButton);
  }

  return row;
}

function formatEasingLabel(easing: TemplateTransitionEasing) {
  switch (easing) {
    case "linear":
      return "Linear";
    case "easeIn":
      return "Ease in";
    case "easeOut":
      return "Ease out";
    case "easeInOut":
      return "Ease in/out";
  }
}

function getTransitionEasingOptions() {
  const options = [
    "linear",
    "easeIn",
    "easeOut",
    "easeInOut",
  ] satisfies TemplateTransitionEasing[];
  return Object.fromEntries(
    options.map((easing) => [formatEasingLabel(easing), easing]),
  ) as Record<string, TemplateTransitionEasing>;
}

function runTemplateAction(
  button: HTMLButtonElement,
  action: () => void | Promise<void>,
) {
  button.disabled = true;
  Promise.resolve(action())
    .catch((error: unknown) => {
      console.error(error);
    })
    .finally(() => {
      button.disabled = false;
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

function isSelectControl(
  control: PostEffectControlConfig,
): control is SelectControlConfig {
  return "options" in control;
}

function isBooleanControl(
  control: PostEffectControlConfig,
): control is BooleanControlConfig {
  return !isNumericControl(control) && !isSelectControl(control);
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
    const expansionId = `post-effect:${effectId}`;
    const isExpanded = getStoredFolderExpansion(
      folderExpansionState,
      expansionId,
      true,
    );
    const row = document.createElement("div");
    row.className = "post-effect-card";
    if (!settings.postProcessingEnabled) {
      row.classList.add("is-disabled");
    }
    if (!isExpanded) {
      row.classList.add("is-collapsed");
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
        ariaLabel: `${POST_EFFECT_LABELS[effectId]} enabled`,
        disabled: !settings.postProcessingEnabled,
        onChange: (checked) => {
          settings[POST_EFFECT_ENABLED_KEYS[effectId]] = checked;
          onChange();
        },
      }),
    );
    const titleButton = document.createElement("button");
    titleButton.className = "post-effect-title";
    titleButton.type = "button";
    titleButton.textContent = POST_EFFECT_LABELS[effectId];
    titleButton.setAttribute("aria-expanded", String(isExpanded));
    titleButton.addEventListener("click", () => {
      const isCollapsed = row.classList.toggle("is-collapsed");
      const expanded = !isCollapsed;
      titleButton.setAttribute("aria-expanded", String(expanded));
      persistFolderExpansion(expansionId, expanded);
    });
    effectHeader.append(titleButton);
    row.append(effectHeader);

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
      } else if (isSelectControl(control)) {
        effectPane.addBinding(settings, control.key, {
          disabled: !settings.postProcessingEnabled,
          label: control.label,
          options: control.options,
        });
      } else if (isBooleanControl(control)) {
        effectPane.addBinding(settings, control.key, {
          disabled: !settings.postProcessingEnabled,
          label: control.label,
        });
      }
    }
    effectPane.on("change", onChange);
    postPanes.push(effectPane);
    row.append(controls);

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

function radiansToRotationPoint(radians: number) {
  const safeRadians = Number.isFinite(radians) ? radians : 0;
  return {
    x: Math.cos(safeRadians),
    y: Math.sin(safeRadians),
  };
}

function rotationPointToRadians(
  point: { x: number; y: number },
  fallbackRadians: number,
) {
  const x = Number.isFinite(point.x) ? point.x : 0;
  const y = Number.isFinite(point.y) ? point.y : 0;
  if (Math.hypot(x, y) < 0.0001) {
    return Number.isFinite(fallbackRadians) ? fallbackRadians : 0;
  }

  return Math.atan2(y, x);
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
  ariaLabel,
  checked,
  className,
  disabled = false,
  label,
  onChange,
}: {
  ariaLabel?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  label?: string;
  onChange: (checked: boolean) => void;
}) {
  const wrapper = document.createElement("label");
  wrapper.className = ["post-checkbox", className].filter(Boolean).join(" ");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  if (ariaLabel) {
    input.setAttribute("aria-label", ariaLabel);
  }
  input.addEventListener("change", () => {
    onChange(input.checked);
  });
  wrapper.append(input);
  if (label) {
    const text = document.createElement("span");
    text.textContent = label;
    wrapper.append(text);
  }
  return wrapper;
}
