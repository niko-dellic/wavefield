import * as THREE from "three";

import type { ModalFieldRenderStats } from "../webgl/ModalFieldRenderer";
import type { EffectiveCymaticSettings } from "../types";

type GpuTimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

type PendingGpuQuery = {
  query: WebGLQuery;
};

export type RenderProfilerFrameContext = {
  settings: EffectiveCymaticSettings;
  renderStats: ModalFieldRenderStats;
  modeCount: number;
  updateMilliseconds: number;
  renderMilliseconds: number;
  settingsRefreshMilliseconds: number;
  didRefreshSettings: boolean;
};

type RenderProfilerOptions = {
  overlay: boolean;
  summaryIntervalMilliseconds: number;
};

export type ProfileScenarioName = string;

export type MetricSnapshot = {
  average: number;
  worst: number;
  count: number;
};

export type ProfileSummary = {
  frames: MetricSnapshot;
  update: MetricSnapshot;
  render: MetricSnapshot;
  gpuRender: MetricSnapshot | null;
  settingsRefresh: MetricSnapshot;
  context: Record<string, string | number | boolean>;
};

export type ProfileScenarioResult = {
  name: ProfileScenarioName;
  capturedAt: string;
  summary: ProfileSummary;
};

export type WavefieldProfilerApi = {
  snapshot: (name?: ProfileScenarioName) => ProfileScenarioResult | null;
};

declare global {
  interface Window {
    __wavefieldProfiler?: WavefieldProfilerApi;
  }
}

/**
 * Dev-only frame profiler for separating CPU update work, WebGL render work,
 * and optional GPU timer-query cost without changing render quality.
 */
export class RenderProfiler {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly gpuTimer: GpuTimerExtension | null;
  private readonly pendingGpuQueries: PendingGpuQuery[] = [];
  private readonly frameMetric = new RollingMetric();
  private readonly updateMetric = new RollingMetric();
  private readonly renderMetric = new RollingMetric();
  private readonly settingsRefreshMetric = new RollingMetric();
  private readonly gpuRenderMetric = new RollingMetric();
  private readonly overlayElement: HTMLDivElement | null;
  private activeGpuQuery: WebGLQuery | null = null;
  private frameStartMilliseconds = 0;
  private lastSummaryMilliseconds = performance.now();
  private latestContext: RenderProfilerFrameContext | null = null;

  public constructor(
    private readonly renderer: THREE.WebGLRenderer,
    options: RenderProfilerOptions,
  ) {
    const context = renderer.getContext();
    this.gl = isWebGl2Context(context) ? context : null;
    this.gpuTimer =
      this.gl?.getExtension("EXT_disjoint_timer_query_webgl2") ?? null;
    this.overlayElement = options.overlay ? createOverlayElement() : null;
    this.summaryIntervalMilliseconds = options.summaryIntervalMilliseconds;
    this.installGlobalApi();
  }

  private readonly summaryIntervalMilliseconds: number;

  /** Marks the start of a frame for rolling frame-time accounting. */
  public beginFrame(nowMilliseconds: number): void {
    this.frameStartMilliseconds = nowMilliseconds;
    this.pollGpuQueries();
  }

  /** Returns a closure that records elapsed CPU time into the named bucket. */
  public beginCpuMeasure(
    metric: "update" | "render" | "settingsRefresh",
  ): () => number {
    const start = performance.now();
    return (): number => {
      const elapsed = performance.now() - start;
      this.getCpuMetric(metric).add(elapsed);
      return elapsed;
    };
  }

  /**
   * Starts a GPU timer query when WebGL2 exposes disjoint timer queries.
   * The result becomes available asynchronously and is folded into later logs.
   */
  public beginGpuRenderMeasure(): () => void {
    if (!this.gl || !this.gpuTimer || this.activeGpuQuery) {
      return (): void => undefined;
    }

    const query = this.gl.createQuery();
    if (!query) {
      return (): void => undefined;
    }

    try {
      this.gl.beginQuery(this.gpuTimer.TIME_ELAPSED_EXT, query);
      this.activeGpuQuery = query;
    } catch {
      this.gl.deleteQuery(query);
      return (): void => undefined;
    }

    return (): void => {
      if (this.activeGpuQuery !== query || !this.gl || !this.gpuTimer) {
        return;
      }

      try {
        this.gl.endQuery(this.gpuTimer.TIME_ELAPSED_EXT);
        this.pendingGpuQueries.push({ query });
      } catch {
        this.gl.deleteQuery(query);
      } finally {
        this.activeGpuQuery = null;
      }
    };
  }

  /** Completes frame accounting and updates the optional overlay at a low cadence. */
  public endFrame(
    nowMilliseconds: number,
    context: RenderProfilerFrameContext,
  ): void {
    this.latestContext = context;
    this.frameMetric.add(nowMilliseconds - this.frameStartMilliseconds);

    if (
      nowMilliseconds - this.lastSummaryMilliseconds <
      this.summaryIntervalMilliseconds
    ) {
      return;
    }

    this.lastSummaryMilliseconds = nowMilliseconds;
    const summary = this.createSummary(context);
    this.updateOverlay(summary);
    this.resetMetrics();
  }

  /** Removes the optional profile overlay and clears outstanding GPU queries. */
  public dispose(): void {
    if (window.__wavefieldProfiler?.snapshot === this.snapshot) {
      delete window.__wavefieldProfiler;
    }
    this.overlayElement?.remove();
    if (!this.gl) {
      return;
    }
    for (const pending of this.pendingGpuQueries.splice(0)) {
      this.gl.deleteQuery(pending.query);
    }
    if (this.activeGpuQuery) {
      this.gl.deleteQuery(this.activeGpuQuery);
      this.activeGpuQuery = null;
    }
  }

  /**
   * Captures the current rolling profiler state for repeatable scenario runs.
   * Metrics continue accumulating after the snapshot so browser smoke tests can
   * take several named samples without disturbing the overlay cadence.
   */
  private readonly snapshot = (
    name: ProfileScenarioName = "manual",
  ): ProfileScenarioResult | null => {
    this.pollGpuQueries();
    if (!this.latestContext) {
      return null;
    }

    return {
      name,
      capturedAt: new Date().toISOString(),
      summary: this.createSummary(this.latestContext),
    };
  };

  /** Exposes a tiny dev/profile API for scripted browser scenario captures. */
  private installGlobalApi(): void {
    window.__wavefieldProfiler = {
      snapshot: this.snapshot,
    };
  }

  private getCpuMetric(
    metric: "update" | "render" | "settingsRefresh",
  ): RollingMetric {
    switch (metric) {
      case "update":
        return this.updateMetric;
      case "render":
        return this.renderMetric;
      case "settingsRefresh":
        return this.settingsRefreshMetric;
    }
  }

  private pollGpuQueries(): void {
    if (!this.gl || !this.gpuTimer) {
      return;
    }

    for (let index = this.pendingGpuQueries.length - 1; index >= 0; index -= 1) {
      const pending = this.pendingGpuQueries[index];
      const isAvailable = Boolean(
        this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT_AVAILABLE),
      );
      if (!isAvailable) {
        continue;
      }

      const isDisjoint = Boolean(this.gl.getParameter(this.gpuTimer.GPU_DISJOINT_EXT));
      if (!isDisjoint) {
        const elapsedNanoseconds = Number(
          this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT),
        );
        this.gpuRenderMetric.add(elapsedNanoseconds / 1_000_000);
      }

      this.gl.deleteQuery(pending.query);
      this.pendingGpuQueries.splice(index, 1);
    }
  }

  private createSummary(context: RenderProfilerFrameContext): ProfileSummary {
    const canvas = this.renderer.domElement;
    const settings = context.settings;
    return {
      frames: this.frameMetric.snapshot(),
      update: this.updateMetric.snapshot(),
      render: this.renderMetric.snapshot(),
      gpuRender: this.gpuRenderMetric.hasSamples()
        ? this.gpuRenderMetric.snapshot()
        : null,
      settingsRefresh: this.settingsRefreshMetric.snapshot(),
      context: {
        projection: settings.projectionMode,
        fieldModel: settings.fieldModel,
        resonance: settings.boundaryMode,
        postPasses: context.renderStats.postProcessing.activeEffects.join(">") || "none",
        modeCount: context.modeCount,
        modalCountSetting: settings.modalCount,
        pixelRatio: this.renderer.getPixelRatio(),
        canvas: `${canvas.width}x${canvas.height}`,
        density: settings.cymaticDensity,
        harmonicMix: settings.cymaticHarmonicMix,
        interference: settings.cymaticInterference,
        warp: settings.cymaticWarp,
        sphereRaymarchSteps: settings.sphereRaymarchSteps,
        didRefreshSettings: context.didRefreshSettings,
      },
    };
  }

  private updateOverlay(summary: ProfileSummary): void {
    if (!this.overlayElement) {
      return;
    }

    const gpu = summary.gpuRender
      ? `${summary.gpuRender.average.toFixed(1)} gpu`
      : "gpu n/a";
    this.overlayElement.textContent = [
      `${summary.frames.average.toFixed(1)} ms frame`,
      `${summary.update.average.toFixed(1)} upd / ${summary.render.average.toFixed(1)} rnd / ${gpu}`,
      `${summary.context.fieldModel} / ${summary.context.resonance}`,
      `${summary.context.postPasses}`,
      `${summary.context.canvas} @ ${summary.context.pixelRatio}x`,
    ].join("\n");
  }

  private resetMetrics(): void {
    this.frameMetric.reset();
    this.updateMetric.reset();
    this.renderMetric.reset();
    this.settingsRefreshMetric.reset();
    this.gpuRenderMetric.reset();
  }
}

/** Creates a profiler in dev builds, or in an explicit profile URL session. */
export function createRenderProfiler(
  renderer: THREE.WebGLRenderer,
): RenderProfiler | null {
  const params = new URLSearchParams(window.location.search);
  const requestedProfile =
    params.get("profile") === "1" || params.has("profile");
  if (!import.meta.env.DEV && !requestedProfile) {
    return null;
  }

  return new RenderProfiler(renderer, {
    overlay: requestedProfile,
    summaryIntervalMilliseconds: requestedProfile ? 2_000 : 5_000,
  });
}

class RollingMetric {
  private sum = 0;
  private count = 0;
  private worst = 0;

  public add(value: number): void {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    this.sum += value;
    this.count += 1;
    this.worst = Math.max(this.worst, value);
  }

  public hasSamples(): boolean {
    return this.count > 0;
  }

  public snapshot(): MetricSnapshot {
    return {
      average: this.count > 0 ? this.sum / this.count : 0,
      worst: this.worst,
      count: this.count,
    };
  }

  public reset(): void {
    this.sum = 0;
    this.count = 0;
    this.worst = 0;
  }
}

function isWebGl2Context(
  context: WebGLRenderingContext | WebGL2RenderingContext,
): context is WebGL2RenderingContext {
  return (
    typeof WebGL2RenderingContext !== "undefined" &&
    context instanceof WebGL2RenderingContext
  );
}

function createOverlayElement(): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "wavefield-profile-overlay";
  Object.assign(element.style, {
    position: "fixed",
    right: "8px",
    bottom: "8px",
    zIndex: "1000",
    padding: "6px 8px",
    border: "1px solid rgba(255,255,255,0.24)",
    borderRadius: "6px",
    background: "rgba(0,0,0,0.72)",
    color: "#e8fbff",
    font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "pre",
    pointerEvents: "none",
  });
  document.body.append(element);
  return element;
}
