export type FrequencyBand = "low" | "mid" | "high";
export type ProjectionMode = "screen" | "sphere";
export type FieldModel =
  | "modalPlate"
  | "radialPlate"
  | "faradayPulse"
  | "spiralPhase";
export type BoundaryMode =
  | "freePlate"
  | "dirichlet"
  | "neumann"
  | "clamped"
  | "supported";
export type ColorMode =
  | "chromesthesia"
  | "mono"
  | "bandSplit"
  | "thermalPhase"
  | "heatmap";
export type HeatmapPalette = "scientificHeat" | "blackbody" | "turbo";
export type SphereFieldMode = "surface" | "volume";
export type SphereProjectionType = "uv" | "triplanar";
export type ScreenAspectMode = "circle" | "fit";
export type IdleMode = "ambient";
export type MonitorSignal =
  | "frequency"
  | "level"
  | "excitation"
  | "change"
  | "pulse"
  | "low"
  | "mid"
  | "high";
export type PostEffectId =
  | "bloom"
  | "pixelation"
  | "fisheye"
  | "alphaDecay"
  | "terminal";
export type FieldModelWeights = Record<FieldModel, number>;
export type BoundaryWeights = Record<BoundaryMode, number>;
export type PostEffectAmounts = Record<PostEffectId, number>;
export type AlphaDecayBlendMode =
  | "normal"
  | "screen"
  | "multiply"
  | "overlay"
  | "add"
  | "subtract"
  | "darken"
  | "lighten"
  | "difference"
  | "exclusion"
  | "softLight"
  | "hardLight";
export type DriveMode = "audio" | "manual" | "live";

export type SpectralPeak = {
  frequency: number;
  amplitude: number;
  energy: number;
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
  excitation: number;
  topology: number;
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
  fieldModel: FieldModel;
  boundaryMode: BoundaryMode;
  colorMode: ColorMode;
  sphereFieldMode: SphereFieldMode;
  sphereProjectionType: SphereProjectionType;
  screenAspectMode: ScreenAspectMode;
  idleMode: IdleMode;
  monitorSignal: MonitorSignal;
  backgroundColor: string;
  heatmapPalette: HeatmapPalette;
  monoColor: string;
  thermalColdColor: string;
  thermalHotColor: string;
  cymaticDensity: number;
  cymaticBrightness: number;
  cymaticOpacity: number;
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
  audioResponse: number;
  driveMode: DriveMode;
  testFrequency: number;
  frequencySweep: boolean;
  frequencySweepRate: number;
  frequencySweepRange: number;
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
  sphereRaymarchSteps: number;
  sphereAbsorption: number;
  sphereShellBias: number;
  sphereInteriorGlow: number;
  sphereBackgroundTransparent: boolean;
  postProcessingEnabled: boolean;
  postEffectOrder: PostEffectId[];
  postBloomEnabled: boolean;
  postBloomIntensity: number;
  postPixelationEnabled: boolean;
  postPixelSize: number;
  postFisheyeEnabled: boolean;
  postFisheyeK1: number;
  postFisheyeK2: number;
  postFisheyeStrength: number;
  postAlphaDecayEnabled: boolean;
  postAlphaDecayFrames: number;
  postAlphaDecayBlendMode: AlphaDecayBlendMode;
  terminalContourEnabled: boolean;
  terminalCellSize: number;
  terminalContourLevels: number;
  terminalContourStrength: number;
  terminalContourThreshold: number;
};

export type EffectiveCymaticSettings = CymaticSettings & {
  fieldModelWeights: FieldModelWeights;
  boundaryWeights: BoundaryWeights;
  postEffectAmounts: PostEffectAmounts;
};

export const BAND_COLORS: Record<FrequencyBand, [number, number, number]> = {
  low: [0.18, 0.78, 0.96],
  mid: [0.9, 0.96, 1],
  high: [1, 0.72, 0.34],
};
