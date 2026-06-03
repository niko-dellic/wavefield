export type FrequencyBand = "low" | "mid" | "high";
export type OriginMode = "mono" | "split";
export type SimulationMode = "modal" | "bursts" | "wave";
export type ProjectionMode = "screen" | "sphere";
export type BoundaryMode = "dirichlet" | "neumann";
export type ColorMode = "chromesthesia" | "mono" | "bandSplit" | "thermalPhase";
export type PulseBlendMode =
  | "mix"
  | "lighten"
  | "screen"
  | "average"
  | "add"
  | "alphaOver"
  | "alphaMix"
  | "maxEnergy"
  | "overlay";

export type AudioFeatureFrame = {
  index: number;
  time: number;
  rms: number;
  centroid: number;
  bands: Record<FrequencyBand, number>;
  onsets: Record<FrequencyBand, number>;
};

export type AudioAnalysis = {
  duration: number;
  sampleRate: number;
  frames: AudioFeatureFrame[];
};

export type CymaticSettings = {
  simulationMode: SimulationMode;
  projectionMode: ProjectionMode;
  boundaryMode: BoundaryMode;
  colorMode: ColorMode;
  blendMode: PulseBlendMode;
  decaySeconds: number;
  pulseOpacity: number;
  fillOpacity: number;
  cymaticDensity: number;
  cymaticSymmetry: number;
  cymaticHarmonicMix: number;
  cymaticNodeWidth: number;
  cymaticSoftness: number;
  cymaticInterference: number;
  cymaticEdgeFade: number;
  cymaticWarp: number;
  cymaticWarpScale: number;
  cymaticDrift: number;
  lightBackgroundMode: boolean;
  gain: number;
  sensitivity: number;
  originMode: OriginMode;
  lowScale: number;
  midScale: number;
  highScale: number;
  sourceSpread: number;
  modalCount: number;
  modalDecay: number;
  modalDrive: number;
  sourceX: number;
  sourceY: number;
  chromesthesiaMix: number;
  sphereRadius: number;
  sphereRotation: number;
};

export type PulseBurst = {
  centerUv: [number, number];
  reachRadius: number;
  edgeRadius: number;
  intensity: number;
  phaseSeed: number;
  color: [number, number, number];
};

export const DEFAULT_SETTINGS: CymaticSettings = {
  simulationMode: "modal",
  projectionMode: "screen",
  boundaryMode: "neumann",
  colorMode: "chromesthesia",
  blendMode: "screen",
  decaySeconds: 1.8,
  pulseOpacity: 0.88,
  fillOpacity: 0.72,
  cymaticDensity: 0.82,
  cymaticSymmetry: 6,
  cymaticHarmonicMix: 0.34,
  cymaticNodeWidth: 0.052,
  cymaticSoftness: 0.38,
  cymaticInterference: 0.62,
  cymaticEdgeFade: 0.14,
  cymaticWarp: 0.34,
  cymaticWarpScale: 0.72,
  cymaticDrift: 0.16,
  lightBackgroundMode: false,
  gain: 1,
  sensitivity: 1,
  originMode: "mono",
  lowScale: 1,
  midScale: 1,
  highScale: 1,
  sourceSpread: 0.14,
  modalCount: 28,
  modalDecay: 1.45,
  modalDrive: 1,
  sourceX: 0.5,
  sourceY: 0.5,
  chromesthesiaMix: 0.82,
  sphereRadius: 1.35,
  sphereRotation: 0.08,
};

export const BAND_COLORS: Record<FrequencyBand, [number, number, number]> = {
  low: [0.18, 0.78, 0.96],
  mid: [0.9, 0.96, 1],
  high: [1, 0.72, 0.34],
};
