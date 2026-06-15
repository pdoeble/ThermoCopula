"use strict";

const assert = require("node:assert/strict");
const {
  DEFAULTS,
  calculateResults,
  generateSweepValues,
  buildScenarioPlotData,
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

assert.deepEqual(generateSweepValues(1, 5, 5, true), [1, 2, 3, 4, 5]);
assert.deepEqual(generateSweepValues(5, 1, 3, true), [1, 3, 5]);

const signalSweep = buildScenarioPlotData(defaultInputs(), {
  xAxis: "signals",
  yMetric: "memory",
  yScale: "linear",
  minimum: 1,
  maximum: 24,
  points: 24,
});
assert.equal(signalSweep.series.length, 3);
assert.equal(signalSweep.series[0].points.length, 24);
assert.ok(
  signalSweep.series[1].points.at(-1).y >
    signalSweep.series[1].points[0].y
);

const methodComparison = buildScenarioPlotData(defaultInputs(), {
  xAxis: "method",
  yMetric: "memory",
  yScale: "log",
});
assert.equal(methodComparison.series.length, 1);
assert.equal(methodComparison.series[0].points.length, 3);
assert.equal(methodComparison.xTicks[1].label, "Gaussian");

const counterFormatSweep = buildScenarioPlotData(defaultInputs(), {
  xAxis: "histFormat",
  yMetric: "memory",
  yScale: "linear",
});
assert.deepEqual(
  counterFormatSweep.series[0].points.map((point) => point.y),
  [244, 364, 484]
);

const frequencySweep = buildScenarioPlotData(defaultInputs(), {
  xAxis: "cpuFrequencyMhz",
  yMetric: "cpu",
  yScale: "log",
  minimum: 50,
  maximum: 200,
  points: 4,
});
assert.ok(
  frequencySweep.series[1].points[0].y >
    frequencySweep.series[1].points.at(-1).y
);

console.log("Calculation tests passed.");
