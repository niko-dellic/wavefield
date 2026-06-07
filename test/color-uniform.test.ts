import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { setColorUniform } from "../src/webgl/colorUniforms.ts";

test("shader color uniforms preserve exact UI hex RGB values", () => {
  const color = new THREE.Color();

  setColorUniform(color, "#ff5100", 0x000000);

  assert.equal(color.r, 1);
  assert.equal(color.g, 81 / 255);
  assert.equal(color.b, 0);
});

test("shader color uniforms use the fallback as exact RGB when input is invalid", () => {
  const color = new THREE.Color();

  setColorUniform(color, "nope", 0xff5100);

  assert.equal(color.r, 1);
  assert.equal(color.g, 81 / 255);
  assert.equal(color.b, 0);
});
