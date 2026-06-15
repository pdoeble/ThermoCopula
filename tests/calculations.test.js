"use strict";

const assert = require("node:assert/strict");
const {
  DEFAULTS,
  calculateResults,
} = require("../app.js");

function defaultInputs(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}

const defaults = calculateResults(defaultInputs());

assert.equal(defaults.pairCount, 55);
assert.equal(defaults.methods.histogram.memory.total, 484);
assert.equal(defaults.methods.gaussian.memory.total, 1484);
assert.equal(defaults.methods.t.memory.total, 1488);

assert.deepEqual(defaults.methods.gaussian.memory.components, {
  histograms: 480,
  sampleCounter: 4,
  sumZ: 80,
  sumZZ: 440,
  lut: 480,
  rMatrix: 0,
  nu: 0,
});

assert.equal(defaults.methods.histogram.cycles.total, 280);
assert.equal(defaults.methods.gaussian.cycles.total, 1370);
assert.equal(defaults.methods.t.cycles.total, 1370);
assert.equal(defaults.selected.updates, 36_000_000);
assert.equal(defaults.selected.cpuLoad, 0.00137);
assert.equal(defaults.selected.overflow.histogram.level, "good");
assert.equal(defaults.selected.overflow.copula.level, "good");

const overflowingHistogram = calculateResults(
  defaultInputs({
    method: "histogram",
    histFormat: "uint24",
  })
);
assert.equal(
  overflowingHistogram.selected.overflow.histogram.level,
  "critical"
);

const floatAccumulatorReview = calculateResults(
  defaultInputs({
    accFormat: "float32",
  })
);
assert.equal(
  floatAccumulatorReview.selected.overflow.copula.level,
  "warning"
);
assert.equal(
  floatAccumulatorReview.selected.overflow.copula.label,
  "Precision review"
);

const noLut = calculateResults(
  defaultInputs({
    useLut: false,
  })
);
assert.equal(noLut.selected.memory.components.lut, 0);
assert.equal(noLut.selected.cycles.transform, 2500);

console.log("Calculation tests passed.");
