const scenarios = [
  {
    name: "screen/manual/default",
    url: "http://127.0.0.1:5173/?profile=1",
    notes: "Baseline screen projection with the current manual/default settings.",
  },
  {
    name: "radial/faraday/spiral morphs",
    url: "http://127.0.0.1:5173/?profile=1",
    notes: "Switch field model and resonance controls while watching update/render/GPU times.",
  },
  {
    name: "template morph with post effects",
    url: "http://127.0.0.1:5173/?profile=1",
    notes: "Apply templates that fade bloom, pixelation, alpha decay, fisheye, or terminal.",
  },
  {
    name: "sphere surface and volume",
    url: "http://127.0.0.1:5173/?profile=1",
    notes: "Switch projection to sphere, then compare surface and volume modes.",
  },
];

console.log("Wavefield profile scenarios");
console.log("");
console.log("1. Run `npm run dev` in another terminal.");
console.log("2. Open the listed URL. The profiler logs rolling summaries to the console.");
console.log("3. Record the frame/update/render/GPU averages and worst frames before and after changes.");
console.log("");
for (const scenario of scenarios) {
  console.log(`- ${scenario.name}`);
  console.log(`  ${scenario.url}`);
  console.log(`  ${scenario.notes}`);
}
