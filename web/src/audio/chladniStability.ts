const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 7_200;

type PatternCandidate = {
  key: string;
  frequency: number;
  confidence: number;
  firstSeen: number;
  lastSeen: number;
};

export type PatternStabilityInput = {
  key: string;
  frequency: number;
  confidence: number;
  time: number;
  holdSeconds: number;
  rms: number;
  energy: number;
  change: number;
  beatConfidence: number;
  harmonicity: number;
};

export class ChladniPatternStabilizer {
  private baseFrequency = 220;
  private initialized = false;
  private candidate: PatternCandidate | null = null;

  reset(baseFrequency = 220) {
    this.baseFrequency = clamp(baseFrequency, MIN_FREQUENCY, MAX_FREQUENCY);
    this.initialized = false;
    this.candidate = null;
  }

  update(input: PatternStabilityInput) {
    if (!this.initialized) {
      this.accept(input.frequency);
      return this.baseFrequency;
    }

    const baseDistance = octaveDistance(this.baseFrequency, input.frequency);
    if (baseDistance < 0.12) {
      this.baseFrequency = smoothFrequency(
        this.baseFrequency,
        input.frequency,
        0.055 + input.harmonicity * 0.035,
      );
      this.candidate = null;
      return this.baseFrequency;
    }

    const minConfidence = Math.max(0.018, input.rms * 0.08);
    if (input.confidence < minConfidence) {
      this.expireCandidate(input.time);
      return this.baseFrequency;
    }

    if (
      !this.candidate ||
      this.candidate.key !== input.key ||
      octaveDistance(this.candidate.frequency, input.frequency) > 0.1
    ) {
      this.candidate = {
        key: input.key,
        frequency: input.frequency,
        confidence: input.confidence,
        firstSeen: input.time,
        lastSeen: input.time,
      };
      return this.baseFrequency;
    }

    this.candidate.frequency = smoothFrequency(
      this.candidate.frequency,
      input.frequency,
      0.16,
    );
    this.candidate.confidence = Math.max(
      this.candidate.confidence * 0.94,
      input.confidence,
    );
    this.candidate.lastSeen = input.time;

    const transitionBias = clamp(
      input.change * 0.58 + input.beatConfidence * 0.34 + input.harmonicity * 0.24,
      0,
      0.72,
    );
    const effectiveHoldSeconds = Math.max(
      0.12,
      Math.max(0, input.holdSeconds) * (1 - transitionBias),
    );
    const isSustained =
      input.time - this.candidate.firstSeen >= effectiveHoldSeconds;
    const isClearlyDominant =
      this.candidate.confidence > Math.max(0.025, input.rms * 0.1 + input.energy * 0.05);
    if (isSustained && isClearlyDominant) {
      this.accept(this.candidate.frequency);
    }

    return this.baseFrequency;
  }

  getFrequency() {
    return this.baseFrequency;
  }

  private accept(frequency: number) {
    this.baseFrequency = clamp(frequency, MIN_FREQUENCY, MAX_FREQUENCY);
    this.initialized = true;
    this.candidate = null;
  }

  private expireCandidate(time: number) {
    if (this.candidate && time - this.candidate.lastSeen > 0.24) {
      this.candidate = null;
    }
  }
}

export function octaveDistance(left: number, right: number) {
  return Math.abs(Math.log2(Math.max(1, left) / Math.max(1, right)));
}

export function smoothFrequency(current: number, target: number, amount: number) {
  const currentLog = Math.log2(clamp(current, MIN_FREQUENCY, MAX_FREQUENCY));
  const targetLog = Math.log2(clamp(target, MIN_FREQUENCY, MAX_FREQUENCY));
  return Math.pow(2, currentLog + (targetLog - currentLog) * clamp(amount, 0, 1));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
