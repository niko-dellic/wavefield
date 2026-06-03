import { Pane } from "tweakpane";

import type { CymaticSettings } from "../types";

export function createControls(
  container: HTMLElement,
  settings: CymaticSettings,
  onChange: () => void,
) {
  const pane = new Pane({
    container,
    title: "Wavefield",
  });

  const engine = pane.addFolder({ title: "Engine", expanded: true });
  engine.addBinding(settings, "simulationMode", {
    label: "simulation",
    options: {
      Modal: "modal",
      Bursts: "bursts",
    },
  });
  engine.addBinding(settings, "projectionMode", {
    label: "projection",
    options: {
      Screen: "screen",
      Sphere: "sphere",
    },
  });
  engine.addBinding(settings, "boundaryMode", {
    label: "boundary",
    options: {
      Neumann: "neumann",
      Dirichlet: "dirichlet",
    },
  });
  engine.addBinding(settings, "colorMode", {
    label: "color",
    options: {
      Chromesthesia: "chromesthesia",
      Mono: "mono",
      "Band split": "bandSplit",
      "Thermal phase": "thermalPhase",
    },
  });
  engine.addBinding(settings, "modalCount", {
    label: "modes",
    min: 4,
    max: 32,
    step: 1,
  });
  engine.addBinding(settings, "modalDecay", {
    label: "modal decay",
    min: 0.12,
    max: 5,
    step: 0.01,
  });
  engine.addBinding(settings, "modalDrive", {
    label: "drive",
    min: 0,
    max: 3,
    step: 0.01,
  });
  engine.addBinding(settings, "sourceX", {
    label: "source x",
    min: 0.05,
    max: 0.95,
    step: 0.001,
  });
  engine.addBinding(settings, "sourceY", {
    label: "source y",
    min: 0.05,
    max: 0.95,
    step: 0.001,
  });
  engine.addBinding(settings, "chromesthesiaMix", {
    label: "chroma mix",
    min: 0,
    max: 1,
    step: 0.01,
  });
  engine.addBinding(settings, "sphereRadius", {
    label: "sphere size",
    min: 0.4,
    max: 2.4,
    step: 0.01,
  });
  engine.addBinding(settings, "sphereRotation", {
    label: "sphere spin",
    min: -0.8,
    max: 0.8,
    step: 0.01,
  });

  const shader = pane.addFolder({ title: "Shader", expanded: true });
  shader.addBinding(settings, "blendMode", {
    label: "blend",
    options: {
      Screen: "screen",
      Add: "add",
      Lighten: "lighten",
      Overlay: "overlay",
      "Max energy": "maxEnergy",
      Mix: "mix",
      Average: "average",
      "Alpha over": "alphaOver",
      "Alpha mix": "alphaMix",
    },
  });
  shader.addBinding(settings, "decaySeconds", {
    label: "decay",
    min: 0.2,
    max: 6,
    step: 0.05,
  });
  shader.addBinding(settings, "pulseOpacity", {
    label: "pulse",
    min: 0,
    max: 1.5,
    step: 0.01,
  });
  shader.addBinding(settings, "fillOpacity", {
    label: "fill",
    min: 0,
    max: 1.5,
    step: 0.01,
  });
  shader.addBinding(settings, "cymaticDensity", {
    label: "density",
    min: 0,
    max: 1.5,
    step: 0.01,
  });
  shader.addBinding(settings, "cymaticSymmetry", {
    label: "symmetry",
    min: 1,
    max: 16,
    step: 1,
  });
  shader.addBinding(settings, "cymaticHarmonicMix", {
    label: "harmonic",
    min: 0,
    max: 1.5,
    step: 0.01,
  });
  shader.addBinding(settings, "cymaticNodeWidth", {
    label: "node width",
    min: 0.005,
    max: 0.18,
    step: 0.001,
  });
  shader.addBinding(settings, "cymaticSoftness", {
    label: "softness",
    min: 0,
    max: 1,
    step: 0.01,
  });
  shader.addBinding(settings, "cymaticInterference", {
    label: "interference",
    min: 0,
    max: 1.5,
    step: 0.01,
  });
  shader.addBinding(settings, "cymaticEdgeFade", {
    label: "edge fade",
    min: 0,
    max: 1,
    step: 0.01,
  });
  shader.addBinding(settings, "cymaticWarp", {
    label: "warp",
    min: 0,
    max: 1.2,
    step: 0.01,
  });
  shader.addBinding(settings, "cymaticWarpScale", {
    label: "warp scale",
    min: 0,
    max: 2,
    step: 0.01,
  });
  shader.addBinding(settings, "cymaticDrift", {
    label: "drift",
    min: 0,
    max: 1,
    step: 0.01,
  });
  shader.addBinding(settings, "lightBackgroundMode", {
    label: "light bg",
  });

  const audio = pane.addFolder({ title: "Audio", expanded: true });
  audio.addBinding(settings, "gain", {
    label: "gain",
    min: 0.1,
    max: 4,
    step: 0.01,
  });
  audio.addBinding(settings, "sensitivity", {
    label: "sensitivity",
    min: 0.05,
    max: 4,
    step: 0.01,
  });
  audio.addBinding(settings, "lowScale", {
    label: "low",
    min: 0,
    max: 3,
    step: 0.01,
  });
  audio.addBinding(settings, "midScale", {
    label: "mid",
    min: 0,
    max: 3,
    step: 0.01,
  });
  audio.addBinding(settings, "highScale", {
    label: "high",
    min: 0,
    max: 3,
    step: 0.01,
  });
  audio.addBinding(settings, "sourceSpread", {
    label: "spread",
    min: 0,
    max: 0.34,
    step: 0.001,
  });

  pane.on("change", onChange);
  return pane;
}
