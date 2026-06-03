import type {
  AlphaDecayBlendMode,
  CymaticSettings,
  MonitorSignal,
  PostEffectId,
} from "../types";

export const DEFAULT_SETTINGS: CymaticSettings = {
  projectionMode: "screen",
  boundaryMode: "freePlate",
  colorMode: "heatmap",
  sphereFieldMode: "surface",
  sphereProjectionType: "triplanar",
  screenAspectMode: "circle",
  idleMode: "ambient",
  monitorSignal: "frequency",
  backgroundColor: "#000000",
  heatmapPalette: "turbo",
  monoColor: "#60b8db",
  thermalColdColor: "#145ce6",
  thermalHotColor: "#ff7a2e",
  cymaticDensity: 1.2,
  cymaticBrightness: 1.35,
  cymaticOpacity: 1.1,
  cymaticHarmonicMix: 0.42,
  cymaticNodeWidth: 0.058,
  cymaticSoftness: 0.42,
  cymaticInterference: 0.5,
  cymaticEdgeFade: 0.12,
  cymaticWarp: 0.38,
  cymaticWarpScale: 0.78,
  cymaticDrift: 0.18,
  gain: 1.2,
  sensitivity: 1.8,
  audioResponse: 1.5,
  driveMode: "manual",
  testFrequency: 220,
  frequencySweep: true,
  frequencySweepRate: 0.05,
  frequencySweepRange: 1.5,
  lowScale: 1.18,
  midScale: 1.12,
  highScale: 1.08,
  patternHoldSeconds: 0.45,
  morphSeconds: 0.12,
  modalCount: 8,
  modalDecay: 1.25,
  modalDrive: 1.45,
  chromesthesiaMix: 0.82,
  sphereRadius: 1.35,
  sphereSurfaceOpacity: 0.64,
  sphereRaymarchSteps: 56,
  sphereAbsorption: 1.35,
  sphereShellBias: 0.65,
  sphereInteriorGlow: 0.35,
  sphereBackgroundTransparent: false,
  postProcessingEnabled: true,
  postEffectOrder: ["bloom", "pixelation", "fisheye", "terminal", "alphaDecay"],
  postBloomEnabled: false,
  postBloomIntensity: 0.72,
  postPixelationEnabled: false,
  postPixelSize: 6,
  postFisheyeEnabled: true,
  postFisheyeK1: -0.33,
  postFisheyeK2: 0,
  postFisheyeStrength: 1,
  postAlphaDecayEnabled: true,
  postAlphaDecayFrames: 24,
  postAlphaDecayBlendMode: "screen",
  terminalContourEnabled: true,
  terminalCellSize: 9,
  terminalContourLevels: 8,
  terminalContourStrength: 1,
  terminalContourThreshold: 0.09,
};

export type NumericControlConfig = {
  key: keyof CymaticSettings;
  label: string;
  min: number;
  max: number;
  step: number;
};

export type SelectControlConfig = {
  key: keyof CymaticSettings;
  label: string;
  options: Record<string, string>;
};

export type PostEffectControlConfig =
  | NumericControlConfig
  | SelectControlConfig;

export const ALPHA_DECAY_BLEND_OPTIONS: Record<string, AlphaDecayBlendMode> = {
  Normal: "normal",
  Screen: "screen",
  Multiply: "multiply",
  Overlay: "overlay",
  Add: "add",
  Subtract: "subtract",
  Darken: "darken",
  Lighten: "lighten",
  Difference: "difference",
  Exclusion: "exclusion",
  "Soft light": "softLight",
  "Hard light": "hardLight",
};

// Live signal sources selectable in the Signals monitor folder.
export const MONITOR_SIGNAL_OPTIONS: Record<string, MonitorSignal> = {
  "Frequency (Hz)": "frequency",
  "Level (RMS)": "level",
  Excitation: "excitation",
  Change: "change",
  Pulse: "pulse",
  "Low band": "low",
  "Mid band": "mid",
  "High band": "high",
};

export const ENGINE_CONTROLS = {
  modalCount: {
    key: "modalCount",
    label: "modes",
    min: 1,
    max: 12,
    step: 1,
  },
  modalDecay: {
    key: "modalDecay",
    label: "decay (hold)",
    min: 0.12,
    max: 8,
    step: 0.01,
  },
  modalDrive: {
    key: "modalDrive",
    label: "mode drive",
    min: 0,
    max: 4,
    step: 0.01,
  },
  patternHoldSeconds: {
    key: "patternHoldSeconds",
    label: "focus",
    min: 0,
    max: 2,
    step: 0.01,
  },
  morphSeconds: {
    key: "morphSeconds",
    label: "morph speed",
    min: 0.03,
    max: 1,
    step: 0.01,
  },
  chromesthesiaMix: {
    key: "chromesthesiaMix",
    label: "chroma mix",
    min: 0,
    max: 1,
    step: 0.01,
  },
} satisfies Record<string, NumericControlConfig>;

export const SPHERE_CONTROLS = {
  sphereRaymarchSteps: {
    key: "sphereRaymarchSteps",
    label: "steps",
    min: 16,
    max: 96,
    step: 1,
  },
  sphereAbsorption: {
    key: "sphereAbsorption",
    label: "absorption",
    min: 0.1,
    max: 3,
    step: 0.01,
  },
  sphereShellBias: {
    key: "sphereShellBias",
    label: "shell bias",
    min: 0,
    max: 1.5,
    step: 0.01,
  },
  sphereInteriorGlow: {
    key: "sphereInteriorGlow",
    label: "interior",
    min: 0,
    max: 1.5,
    step: 0.01,
  },
  sphereSurfaceOpacity: {
    key: "sphereSurfaceOpacity",
    label: "surface alpha",
    min: 0.08,
    max: 1,
    step: 0.01,
  },
  sphereRadius: {
    key: "sphereRadius",
    label: "size",
    min: 0.4,
    max: 2.4,
    step: 0.01,
  },
} satisfies Record<string, NumericControlConfig>;

export const SHADER_CONTROLS = {
  cymaticHarmonicMix: {
    key: "cymaticHarmonicMix",
    label: "harmonic spread",
    min: 0,
    max: 1,
    step: 0.01,
  },
  cymaticDensity: {
    key: "cymaticDensity",
    label: "density",
    min: 0,
    max: 2,
    step: 0.01,
  },
  cymaticBrightness: {
    key: "cymaticBrightness",
    label: "brightness",
    min: 0.1,
    max: 4,
    step: 0.01,
  },
  cymaticOpacity: {
    key: "cymaticOpacity",
    label: "opacity",
    min: 0.1,
    max: 3,
    step: 0.01,
  },
  cymaticNodeWidth: {
    key: "cymaticNodeWidth",
    label: "node width",
    min: 0.005,
    max: 0.18,
    step: 0.001,
  },
  cymaticSoftness: {
    key: "cymaticSoftness",
    label: "softness",
    min: 0,
    max: 1,
    step: 0.01,
  },
  cymaticInterference: {
    key: "cymaticInterference",
    label: "interference",
    min: 0,
    max: 1.5,
    step: 0.01,
  },
  cymaticEdgeFade: {
    key: "cymaticEdgeFade",
    label: "edge fade",
    min: 0,
    max: 1,
    step: 0.01,
  },
  cymaticWarp: {
    key: "cymaticWarp",
    label: "warp",
    min: 0,
    max: 1.2,
    step: 0.01,
  },
  cymaticWarpScale: {
    key: "cymaticWarpScale",
    label: "warp scale",
    min: 0,
    max: 2,
    step: 0.01,
  },
  cymaticDrift: {
    key: "cymaticDrift",
    label: "drift",
    min: 0,
    max: 1,
    step: 0.01,
  },
} satisfies Record<string, NumericControlConfig>;

export const AUDIO_CONTROLS = {
  testFrequency: {
    key: "testFrequency",
    label: "test Hz",
    min: 70,
    max: 7_200,
    step: 1,
  },
  frequencySweepRate: {
    key: "frequencySweepRate",
    label: "sweep rate",
    min: 0.01,
    max: 0.5,
    step: 0.01,
  },
  frequencySweepRange: {
    key: "frequencySweepRange",
    label: "sweep range",
    min: 0.1,
    max: 4,
    step: 0.05,
  },
  gain: {
    key: "gain",
    label: "excitation gain",
    min: 0.1,
    max: 4,
    step: 0.01,
  },
  sensitivity: {
    key: "sensitivity",
    label: "topology sensitivity",
    min: 0.05,
    max: 5,
    step: 0.01,
  },
  audioResponse: {
    key: "audioResponse",
    label: "response",
    min: 0.5,
    max: 4,
    step: 0.01,
  },
  lowScale: {
    key: "lowScale",
    label: "low",
    min: 0,
    max: 4,
    step: 0.01,
  },
  midScale: {
    key: "midScale",
    label: "mid",
    min: 0,
    max: 4,
    step: 0.01,
  },
  highScale: {
    key: "highScale",
    label: "high",
    min: 0,
    max: 4,
    step: 0.01,
  },
} satisfies Record<string, NumericControlConfig>;

export const POST_EFFECT_LABELS: Record<PostEffectId, string> = {
  bloom: "Bloom",
  pixelation: "Pixelation",
  fisheye: "Fisheye",
  alphaDecay: "Alpha decay",
  terminal: "Terminal contours",
};

export const POST_EFFECT_CONTROLS: Record<
  PostEffectId,
  PostEffectControlConfig[]
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
  fisheye: [
    {
      key: "postFisheyeK1",
      label: "K1",
      min: -1,
      max: 1,
      step: 0.01,
    },
    {
      key: "postFisheyeK2",
      label: "K2",
      min: -1,
      max: 1,
      step: 0.01,
    },
    {
      key: "postFisheyeStrength",
      label: "Strength",
      min: 0,
      max: 2,
      step: 0.01,
    },
  ],
  alphaDecay: [
    {
      key: "postAlphaDecayFrames",
      label: "Trail frames",
      min: 1,
      max: 180,
      step: 1,
    },
    {
      key: "postAlphaDecayBlendMode",
      label: "Blend",
      options: ALPHA_DECAY_BLEND_OPTIONS,
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
      min: 2,
      max: 18,
      step: 1,
    },
    {
      key: "terminalContourStrength",
      label: "Line power",
      min: 0.1,
      max: 3,
      step: 0.01,
    },
    {
      key: "terminalContourThreshold",
      label: "Threshold",
      min: 0.01,
      max: 0.4,
      step: 0.001,
    },
  ],
};

// Hover tooltips for GUI controls, keyed by settings field. Surfaced via the
// `title` attribute on each Tweakpane row.
export const SETTING_DESCRIPTIONS: Partial<Record<keyof CymaticSettings, string>> = {
  projectionMode: "Render the field on a flat screen plate or wrapped onto a sphere.",
  colorMode:
    "How the field is colored: chromesthesia (pitch-mapped hue), mono, frequency-band split, thermal phase, or heatmap.",
  heatmapPalette:
    "Heatmap palette used when color is Heatmap: scientific heat, blackbody, or turbo-style.",
  backgroundColor:
    "Visualization backdrop color. This fills empty field regions and can change post-effect contrast.",
  monoColor:
    "Single hue used by Mono mode. The renderer still varies brightness across the field.",
  thermalColdColor:
    "Cold-side color used by Thermal phase when the field phase is low.",
  thermalHotColor:
    "Hot-side color used by Thermal phase when the field phase is high.",
  boundaryMode:
    "Plate edge condition that defines the figure family: free plate, Dirichlet (clamped), or Neumann.",
  screenAspectMode:
    "Circle keeps the figure square/centered regardless of window shape; Fit stretches it to the viewport.",
  monitorSignal:
    "Which live signal feeds the graph monitor below: frequency, level, the excitation/change/pulse signals, or a frequency band.",
  modalCount:
    "Maximum number of Chladni modes layered at once. Lower = cleaner single figures; higher = busier, more complex patterns.",
  sensitivity:
    "How strongly audio level drives the figure's presence (its geometry), independent of glow.",
  audioResponse:
    "Dynamics curve. Above 1 lifts quiet moments so subtle sounds make bigger changes; 1 is linear; below 1 only loud hits show.",
  patternHoldSeconds:
    "Focus: contrast between the dominant figure and weaker modes. Higher = one crisp figure; lower = several modes share the field.",
  morphSeconds:
    "How fast modes rise to a new shape (attack). Lower = snappier and more reactive; higher = smoother, slower morphing.",
  cymaticHarmonicMix:
    "Harmonic spread: layers a higher overtone of each figure as extra texture/detail.",
  gain: "Master gain on audio excitation — overall brightness/energy response to the audio.",
  modalDrive: "How strongly audio energizes each mode's glow/excitation.",
  modalDecay:
    "Decay/hold: how long modes (and their glow) linger after the triggering sound fades before returning to rest.",
  lowScale: "Weighting of low-frequency (bass) content in the pattern.",
  midScale: "Weighting of mid-frequency content in the pattern.",
  highScale: "Weighting of high-frequency (treble) content in the pattern.",
  cymaticDensity:
    "How much of the field lights up — raises overall coverage and intensity of the nodal pattern.",
  cymaticBrightness: "Master exposure on the rendered color. Push up for bolder, brighter lines.",
  cymaticOpacity:
    "How solid vs. transparent the field renders. Higher makes the pattern more opaque.",
  cymaticNodeWidth:
    "Thickness of the nodal lines. Larger = thicker, bolder lines; smaller = fine and crisp.",
  cymaticSoftness: "Soft glow/bleed around the nodal lines.",
  cymaticInterference:
    "Overlays a transposed partner figure to create moiré cross-lattice detail.",
  cymaticEdgeFade: "Controls how contour edges taper off based on the field gradient.",
  cymaticWarp: "Amount of organic domain warping applied to the field for a more fluid look.",
  cymaticWarpScale:
    "Scale of the warp noise — larger = broad swirls; smaller = finer turbulence.",
  cymaticDrift: "Slow continuous drift of the field over time.",
  chromesthesiaMix:
    "Blend between neutral coloring and pitch-class color mapping (chromesthesia).",
  testFrequency: "Manual drive: the frequency (Hz) fed to the engine to pick the figure.",
  frequencySweep:
    "Manual drive: continuously oscillate the frequency around the test Hz.",
  frequencySweepRate: "Manual drive: how fast the sweep oscillates.",
  frequencySweepRange:
    "Manual drive: how far the sweep roams around the test Hz, in octaves (the intensity of the morph).",
  sphereFieldMode: "Render the figure on the sphere surface, or as a volumetric interior.",
  sphereProjectionType:
    "How the 2D figure maps onto the sphere: triplanar (seamless) or UV.",
  sphereRaymarchSteps:
    "Volume quality — more steps give a smoother volume at higher GPU cost.",
  sphereAbsorption: "How quickly the volume accumulates opacity along each ray.",
  sphereShellBias: "Biases density toward the outer shell vs. throughout the volume.",
  sphereInteriorGlow: "Brightness of the volume's interior body fill.",
  sphereSurfaceOpacity: "Opacity of the sphere surface / transparent volume.",
  sphereRadius: "Size of the sphere in the view.",
  sphereBackgroundTransparent: "Render the sphere over a transparent background.",
  postBloomIntensity: "Strength of the bloom glow.",
  postPixelSize: "Size of the pixelation blocks.",
  postFisheyeK1: "Primary fisheye lens distortion coefficient.",
  postFisheyeK2: "Secondary fisheye lens distortion coefficient.",
  postFisheyeStrength: "Overall strength of the fisheye distortion.",
  postAlphaDecayFrames:
    "Approximate frame count for the alpha-decay trail. Higher values linger longer.",
  postAlphaDecayBlendMode:
    "How the decayed history blends with the current frame.",
  terminalCellSize: "Size of the terminal/ASCII contour cells.",
  terminalContourLevels: "Number of contour bands drawn.",
  terminalContourStrength: "Contrast/strength of the contour lines.",
  terminalContourThreshold: "Minimum field level before contour lines appear.",
};
