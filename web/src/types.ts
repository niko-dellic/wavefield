export type FrequencyBand = "low" | "mid" | "high";
export type ProjectionMode = "screen" | "sphere";
export type BoundaryMode = "freePlate" | "dirichlet" | "neumann";
export type ColorMode = "chromesthesia" | "mono" | "bandSplit" | "thermalPhase";
export type SphereProjectionType = "uv" | "triplanar";
export type ScreenAspectMode = "circle" | "fit";
export type IdleMode = "ambient";
export type PostEffectId = "bloom" | "pixelation" | "terminal";
export type DriveMode = "audio" | "manual";

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
  cymaticHarmonicMix: number;
  cymaticNodeWidth: number;
  cymaticSoftness: number;
  cymaticInterference: number;
  cymaticEdgeFade: number;
  cymaticWarp: number;
  cymaticWarpScale: number;
  cymaticDrift: number;
  gain: number;
  sensitivity: number;
  driveMode: DriveMode;
  testFrequency: number;
  frequencySweep: boolean;
  frequencySweepRate: number;
  lowScale: number;
  midScale: number;
  highScale: number;
  patternHoldSeconds: number;
  morphSeconds: number;
  modalCount: number;
  modalDecay: number;
  modalDrive: number;
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

export const BAND_COLORS: Record<FrequencyBand, [number, number, number]> = {
  low: [0.18, 0.78, 0.96],
  mid: [0.9, 0.96, 1],
  high: [1, 0.72, 0.34],
};
