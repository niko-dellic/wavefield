import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const DEFAULT_URL = "http://127.0.0.1:5173/?profile=1";
const DEFAULT_PORT = 5173;
const DEFAULT_SAMPLES = 3;
const DEFAULT_SETTLE_MS = 1_500;
const SAMPLE_SPACING_MS = 650;

const args = new Set(process.argv.slice(2));
const options = {
  headed: args.has("--headed"),
  json: args.has("--json"),
  noServer: args.has("--no-server"),
  playAudio: !args.has("--no-play"),
  samples: numericArg("--samples", DEFAULT_SAMPLES),
  settleMs: numericArg("--settle", DEFAULT_SETTLE_MS),
  url: stringArg("--url", DEFAULT_URL),
};

const scenarios = [
  {
    id: "screen-audio-default-post-off",
    patch: {
      projectionMode: "screen",
      fieldModel: "modalPlate",
      postProcessingEnabled: false,
    },
  },
  {
    id: "screen-audio-default-current-post",
    patch: {
      projectionMode: "screen",
      fieldModel: "modalPlate",
      postProcessingEnabled: true,
    },
  },
  {
    id: "model-modal-plate",
    patch: {
      projectionMode: "screen",
      fieldModel: "modalPlate",
      postProcessingEnabled: false,
    },
  },
  {
    id: "model-radial-plate",
    patch: {
      projectionMode: "screen",
      fieldModel: "radialPlate",
      postProcessingEnabled: false,
    },
  },
  {
    id: "model-faraday-pulse",
    patch: {
      projectionMode: "screen",
      fieldModel: "faradayPulse",
      postProcessingEnabled: false,
    },
  },
  {
    id: "model-spiral-phase",
    patch: {
      projectionMode: "screen",
      fieldModel: "spiralPhase",
      postProcessingEnabled: false,
    },
  },
  {
    id: "post-fisheye",
    patch: postPatch({ postFisheyeEnabled: true }),
  },
  {
    id: "post-terminal",
    patch: postPatch({ terminalContourEnabled: true }),
  },
  {
    id: "post-alpha-decay",
    patch: postPatch({ postAlphaDecayEnabled: true }),
  },
  {
    id: "post-terminal-alpha",
    patch: postPatch({
      terminalContourEnabled: true,
      postAlphaDecayEnabled: true,
    }),
  },
  {
    id: "sphere-surface",
    patch: {
      projectionMode: "sphere",
      sphereFieldMode: "surface",
      postProcessingEnabled: false,
    },
  },
  {
    id: "sphere-volume",
    patch: {
      projectionMode: "sphere",
      sphereFieldMode: "volume",
      postProcessingEnabled: false,
    },
  },
];

let server = null;
let browser = null;

try {
  if (!options.noServer) {
    server = await startViteServer(DEFAULT_PORT);
  } else {
    await waitForServer(options.url, 10_000);
  }

  const executablePath = findChromeExecutable();
  browser = await chromium.launch({
    executablePath,
    headless: !options.headed,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-angle=metal",
      "--ignore-gpu-blocklist",
    ],
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await page.goto(options.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__wavefieldProfiler), {
    timeout: 10_000,
  });
  await page.waitForFunction(() => Boolean(window.__wavefieldProfileControls), {
    timeout: 10_000,
  });

  if (options.playAudio) {
    await page.locator(".play-toggle").click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }

  const results = [];
  for (const scenario of scenarios) {
    await page.evaluate(
      async ({ patch }) => {
        await window.__wavefieldProfileControls?.applySettings(patch);
      },
      { patch: scenario.patch },
    );
    await page.waitForTimeout(options.settleMs);
    const samples = [];
    for (let index = 0; index < options.samples; index += 1) {
      const sample = await captureSnapshot(page, scenario.id);
      if (sample) {
        samples.push(sample);
      }
      await page.waitForTimeout(SAMPLE_SPACING_MS);
    }
    results.push(summarizeScenario(scenario.id, samples));
  }

  const report = {
    capturedAt: new Date().toISOString(),
    browser: {
      executablePath,
      headed: options.headed,
      url: options.url,
    },
    audioRequested: options.playAudio,
    results,
    errors,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (errors.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  if (server) {
    server.kill("SIGTERM");
  }
}

function postPatch(enabled) {
  return {
    projectionMode: "screen",
    fieldModel: "modalPlate",
    postProcessingEnabled: true,
    postBloomEnabled: false,
    postPixelationEnabled: false,
    postFisheyeEnabled: false,
    postAlphaDecayEnabled: false,
    terminalContourEnabled: false,
    ...enabled,
  };
}

function summarizeScenario(id, samples) {
  const latest = samples.at(-1) ?? null;
  return {
    id,
    sampleCount: samples.length,
    frame: combineMetric(samples, "frames"),
    update: combineMetric(samples, "update"),
    render: combineMetric(samples, "render"),
    settingsRefresh: combineMetric(samples, "settingsRefresh"),
    gpuRender: combineMetric(samples, "gpuRender"),
    context: latest?.summary.context ?? null,
  };
}

async function captureSnapshot(page, scenarioId) {
  await page.waitForFunction(
    (name) => {
      const snapshot = window.__wavefieldProfiler?.snapshot(name);
      return Boolean(
        snapshot &&
          (snapshot.summary.frames.count > 0 ||
            (snapshot.summary.gpuRender?.count ?? 0) > 0),
      );
    },
    scenarioId,
    { timeout: 5_000 },
  );
  return page.evaluate(
    (name) => window.__wavefieldProfiler?.snapshot(name) ?? null,
    scenarioId,
  );
}

function combineMetric(samples, key) {
  const metrics = samples
    .map((sample) => sample.summary[key])
    .filter((metric) => metric && metric.count > 0);
  if (metrics.length === 0) {
    return null;
  }
  const count = metrics.reduce((sum, metric) => sum + metric.count, 0);
  const weightedAverage =
    metrics.reduce(
      (sum, metric) => sum + metric.average * metric.count,
      0,
    ) / Math.max(1, count);
  return {
    average: weightedAverage,
    worst: Math.max(...metrics.map((metric) => metric.worst)),
    count,
  };
}

function printReport(report) {
  console.log("Wavefield browser profile");
  console.log(`${report.browser.executablePath}`);
  console.log(
    `${report.browser.headed ? "headed" : "headless"} / ${report.browser.url}`,
  );
  console.log("");
  for (const result of report.results) {
    const gpu = result.gpuRender
      ? `${result.gpuRender.average.toFixed(2)}ms gpu`
      : "gpu n/a";
    console.log(
      [
        result.id.padEnd(34),
        `${formatMetric(result.frame)} frame`,
        `${formatMetric(result.render)} render`,
        gpu,
        result.context?.postPasses ?? "unknown",
      ].join("  "),
    );
  }
  if (report.errors.length > 0) {
    console.log("");
    console.log("Errors:");
    for (const error of report.errors) {
      console.log(`- ${error}`);
    }
  }
}

function formatMetric(metric) {
  return metric ? `${metric.average.toFixed(2)}ms` : "n/a";
}

async function startViteServer(port) {
  const child = spawn(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (!options.json) {
      process.stderr.write(chunk);
    }
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  await waitForServer(DEFAULT_URL, 15_000);
  return child;
}

async function waitForServer(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function findChromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    throw new Error(
      "Could not find a local Chrome/Chromium executable. Set PLAYWRIGHT_CHROME_EXECUTABLE.",
    );
  }
  return executablePath;
}

function stringArg(name, fallback) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function numericArg(name, fallback) {
  const raw = stringArg(name, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
