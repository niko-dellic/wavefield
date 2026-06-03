export type FrequencyBand = "low" | "mid" | "high";
export type ProjectionMode = "screen" | "sphere";
export type BoundaryMode = "dirichlet" | "neumann" | "open";
export type ColorMode = "chromesthesia" | "mono" | "bandSplit" | "thermalPhase";
export type SphereProjectionType = "uv" | "triplanar";
export type ScreenAspectMode = "circle" | "fit";
export type IdleMode = "ambient";
export type PostEffectId = "bloom" | "pixelation" | "terminal";

export type SpectralPeak = {
  frequency: number;
  amplitude: number;
  bin: number;
  band: FrequencyBand;
  pitchClass: number;
  harmonicWeight: number;
};

export type ChromaProfile = {
  bins: number[];
  tonic: number;
  confidence: number;
  color: [number, number, number];
};

export type AudioFeatureSignals = {
  structure: number;
  energy: number;
  change: number;
  pulse: number;
  beat: number;
  beatConfidence: number;
  harmonicity: number;
  texture: number;
};

export type AudioFeatureFrame = {
  index: number;
  time: number;
  rms: number;
  centroid: number;
  bands: Record<FrequencyBand, number>;
  onsets: Record<FrequencyBand, number>;
  peaks: SpectralPeak[];
  chroma: ChromaProfile;
  signals: AudioFeatureSignals;
  spectralFlux: number;
};

export type AudioAnalysis = {
  duration: number;
  sampleRate: number;
  frames: AudioFeatureFrame[];
};

export type CymaticSettings = {
  projectionMode: ProjectionMode;
  boundaryMode: BoundaryMode;
  colorMode: ColorMode;
  sphereProjectionType: SphereProjectionType;
  screenAspectMode: ScreenAspectMode;
  idleMode: IdleMode;
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
  lowScale: number;
  midScale: number;
  highScale: number;
  modalCount: number;
  modalDecay: number;
  modalDrive: number;
  sourceX: number;
  sourceY: number;
  chromesthesiaMix: number;
  sphereRadius: number;
  sphereSurfaceOpacity: number;
  sphereBackgroundTransparent: boolean;
  postProcessingEnabled: boolean;
  postEffectOrder: PostEffectId[];
  postBloomEnabled: boolean;
  postBloomIntensity: number;
  postPixelationEnabled: boolean;
  postPixelSize: number;
  terminalContourEnabled: boolean;
  terminalCellSize: number;
  terminalContourLevels: number;
  terminalContourStrength: number;
  terminalContourThreshold: number;
};

export const DEFAULT_SETTINGS: CymaticSettings = {
  projectionMode: "screen",
  boundaryMode: "open",
  colorMode: "chromesthesia",
  sphereProjectionType: "triplanar",
  screenAspectMode: "circle",
  idleMode: "ambient",
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
  lowScale: 1,
  midScale: 1,
  highScale: 1,
  modalCount: 28,
  modalDecay: 1.45,
  modalDrive: 1,
  sourceX: 0.5,
  sourceY: 0.5,
  chromesthesiaMix: 0.82,
  sphereRadius: 1.35,
  sphereSurfaceOpacity: 0.64,
  sphereBackgroundTransparent: false,
  postProcessingEnabled: true,
  postEffectOrder: ["bloom", "pixelation", "terminal"],
  postBloomEnabled: false,
  postBloomIntensity: 0.72,
  postPixelationEnabled: false,
  postPixelSize: 6,
  terminalContourEnabled: true,
  terminalCellSize: 9,
  terminalContourLevels: 8,
  terminalContourStrength: 1,
  terminalContourThreshold: 0.09,
};

export const BAND_COLORS: Record<FrequencyBand, [number, number, number]> = {
  low: [0.18, 0.78, 0.96],
  mid: [0.9, 0.96, 1],
  high: [1, 0.72, 0.34],
};
