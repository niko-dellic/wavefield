const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 7_200;

export function mapFrequencyToChladniMode(frequency: number) {
  const safeFrequency = clamp(frequency, MIN_FREQUENCY, MAX_FREQUENCY);
  const scale = Math.sqrt(safeFrequency / 220);
  return {
    frequency: safeFrequency,
    m: clamp(Math.round(scale * 3), 1, 28),
    n: clamp(Math.round(scale * 5), 1, 28),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
