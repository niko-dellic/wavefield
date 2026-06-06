import type { BoundaryMode, DriveMode } from "../types";

export const BOUNDARY_OPTIONS = [
  {
    label: "Free",
    value: "freePlate",
    shortcut: "1",
    title: "Free Plate resonance: antisymmetric Chladni-like plate family.",
  },
  {
    label: "Pinned",
    value: "dirichlet",
    shortcut: "2",
    title: "Pinned resonance: edge-constrained sine family.",
  },
  {
    label: "Open",
    value: "neumann",
    shortcut: "3",
    title: "Open Edge resonance: edge-bright cosine family.",
  },
  {
    label: "Clamped",
    value: "clamped",
    shortcut: "4",
    title: "Clamped resonance: edge-damped constrained family.",
  },
  {
    label: "Supported",
    value: "supported",
    shortcut: "5",
    title:
      "Supported resonance: zero-edge plate family with richer cross-mode symmetry.",
  },
] satisfies Array<{
  label: string;
  value: BoundaryMode;
  shortcut: string;
  title: string;
}>;

export function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function formatFixtureLabel(path: string) {
  const fileName = path.split("/").pop() ?? path;
  const label = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDriveMode(driveMode: DriveMode) {
  return driveMode[0].toUpperCase() + driveMode.slice(1);
}

export function formatBoundaryMode(boundaryMode: BoundaryMode) {
  return (
    BOUNDARY_OPTIONS.find((option) => option.value === boundaryMode)?.label ??
    boundaryMode
  );
}
