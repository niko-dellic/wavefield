const PROFILE_URL = "http://127.0.0.1:5173/?profile=1";

const scenarios = [
  {
    id: "screen-audio-default-post-off",
    title: "Screen audio default, post off",
    url: PROFILE_URL,
    setup: [
      "Projection: screen",
      "Drive: audio",
      "Post processing: disabled",
    ],
    capture: "window.__wavefieldProfiler?.snapshot('screen-audio-default-post-off')",
  },
  {
    id: "screen-audio-default-current-post",
    title: "Screen audio default, current post stack",
    url: PROFILE_URL,
    setup: [
      "Projection: screen",
      "Drive: audio",
      "Post processing: current UI stack",
    ],
    capture:
      "window.__wavefieldProfiler?.snapshot('screen-audio-default-current-post')",
  },
  {
    id: "model-modal-plate",
    title: "Field model: Modal Plate",
    url: PROFILE_URL,
    setup: ["Field model: Modal Plate"],
    capture: "window.__wavefieldProfiler?.snapshot('model-modal-plate')",
  },
  {
    id: "model-radial-plate",
    title: "Field model: Radial Plate",
    url: PROFILE_URL,
    setup: ["Field model: Radial Plate"],
    capture: "window.__wavefieldProfiler?.snapshot('model-radial-plate')",
  },
  {
    id: "model-faraday-pulse",
    title: "Field model: Faraday Pulse",
    url: PROFILE_URL,
    setup: ["Field model: Faraday Pulse"],
    capture: "window.__wavefieldProfiler?.snapshot('model-faraday-pulse')",
  },
  {
    id: "model-spiral-phase",
    title: "Field model: Spiral Phase",
    url: PROFILE_URL,
    setup: ["Field model: Spiral Phase"],
    capture: "window.__wavefieldProfiler?.snapshot('model-spiral-phase')",
  },
  {
    id: "post-fisheye",
    title: "Post effect: Fisheye only",
    url: PROFILE_URL,
    setup: ["Post processing: enabled", "Only Fisheye enabled"],
    capture: "window.__wavefieldProfiler?.snapshot('post-fisheye')",
  },
  {
    id: "post-terminal",
    title: "Post effect: Terminal only",
    url: PROFILE_URL,
    setup: ["Post processing: enabled", "Only Terminal contours enabled"],
    capture: "window.__wavefieldProfiler?.snapshot('post-terminal')",
  },
  {
    id: "post-alpha-decay",
    title: "Post effect: Alpha decay only",
    url: PROFILE_URL,
    setup: ["Post processing: enabled", "Only Alpha decay enabled"],
    capture: "window.__wavefieldProfiler?.snapshot('post-alpha-decay')",
  },
  {
    id: "post-terminal-alpha",
    title: "Post effects: Terminal plus alpha decay",
    url: PROFILE_URL,
    setup: [
      "Post processing: enabled",
      "Only Terminal contours and Alpha decay enabled",
    ],
    capture: "window.__wavefieldProfiler?.snapshot('post-terminal-alpha')",
  },
  {
    id: "sphere-surface",
    title: "Sphere surface projection",
    url: PROFILE_URL,
    setup: ["Projection: sphere", "Sphere field mode: surface"],
    capture: "window.__wavefieldProfiler?.snapshot('sphere-surface')",
  },
  {
    id: "sphere-volume",
    title: "Sphere volume projection",
    url: PROFILE_URL,
    setup: ["Projection: sphere", "Sphere field mode: volume"],
    capture: "window.__wavefieldProfiler?.snapshot('sphere-volume')",
  },
];

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scenarios }, null, 2));
} else if (process.argv.includes("--browser-snippet")) {
  console.log(
    [
      "(() => {",
      "  const results = [];",
      "  const snapshot = (name) => {",
      "    const result = window.__wavefieldProfiler?.snapshot(name);",
      "    if (result) results.push(result);",
      "    return result;",
      "  };",
      "  return { results, snapshot };",
      "})()",
    ].join("\n"),
  );
} else {
  console.log("Wavefield profile scenarios");
  console.log("");
  console.log("1. Run `npm run dev` in another terminal.");
  console.log("2. Open the listed URL and let each scenario settle for a few seconds.");
  console.log("3. Run the capture expression in the browser console.");
  console.log("4. Record frame/update/render/GPU averages, worst frames, and active passes.");
  console.log("");

  for (const scenario of scenarios) {
    console.log(`- ${scenario.id}: ${scenario.title}`);
    console.log(`  ${scenario.url}`);
    console.log(`  setup: ${scenario.setup.join("; ")}`);
    console.log(`  capture: ${scenario.capture}`);
  }
}
