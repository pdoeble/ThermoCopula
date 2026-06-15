"use strict";

const METHOD_ORDER = ["histogram", "gaussian", "t"];

const METHODS = {
  histogram: {
    label: "1D histograms",
    shortLabel: "Histograms",
    information: "Marginal distributions only",
  },
  gaussian: {
    label: "Gaussian copula",
    shortLabel: "Gaussian",
    information: "Pairwise transformed dependence",
  },
  t: {
    label: "t-copula, fixed ν",
    shortLabel: "t-copula",
    information: "Pairwise dependence with fixed tail model",
  },
};

const FORMATS = {
  uint16: { bytes: 2, label: "uint16", limit: 2 ** 16 - 1, kind: "unsigned" },
  uint24: { bytes: 3, label: "uint24", limit: 2 ** 24 - 1, kind: "unsigned" },
  uint32: { bytes: 4, label: "uint32", limit: 2 ** 32 - 1, kind: "unsigned" },
  uint64: { bytes: 8, label: "uint64", limit: 2 ** 64 - 1, kind: "unsigned" },
  int32: { bytes: 4, label: "int32", limit: 2 ** 31 - 1, kind: "signed" },
  int64: { bytes: 8, label: "int64", limit: 2 ** 63 - 1, kind: "signed" },
  float32: {
    bytes: 4,
    label: "float32",
    limit: 3.4028235e38,
    precisionLimit: 2 ** 24,
    kind: "float",
  },
  float64: {
    bytes: 8,
    label: "float64",
    limit: Number.MAX_VALUE,
    precisionLimit: 2 ** 53,
    kind: "float",
  },
};

const MEMORY_COMPONENTS = [
  { key: "histograms", label: "Histograms", color: "#0a6c67" },
  { key: "sampleCounter", label: "Sample counter", color: "#c49a2f" },
  { key: "sumZ", label: "sum_z", color: "#2f69a4" },
  { key: "sumZZ", label: "sum_zz", color: "#7c5aa6" },
  { key: "lut", label: "Transform LUT", color: "#d96b34" },
  { key: "rMatrix", label: "R matrix", color: "#5a7f62" },
  { key: "nu", label: "Fixed ν", color: "#b6413e" },
];

const STATUS_RANK = {
  neutral: 0,
  good: 1,
  warning: 2,
  critical: 3,
};

const DEFAULTS = {
  signals: 10,
  updateRate: 1,
  bins: 12,
  operatingHours: 10000,
  cpuFrequencyMhz: 100,
  method: "gaussian",
  histFormat: "uint32",
  accFormat: "int64",
  sampleFormat: "uint32",
  lutFormat: "float32",
  zMax: 3.5,
  nu: 5,
  useLut: true,
  storeR: false,
  memoryBudgetKb: 16,
  cpuBudgetPercent: 1,
  cyclesClassification: 20,
  cyclesHistIncrement: 8,
  cyclesLutRead: 4,
  cyclesDirectTransform: 250,
  cyclesSumZ: 6,
  cyclesCrossProduct: 18,
  cyclesTExtra: 0,
};

function readNumber(id, fallback, minimum = 0) {
  const element = document.querySelector(`#${id}`);
  const value = Number(element.value);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function getInputs() {
  return {
    signals: Math.round(readNumber("signals", DEFAULTS.signals, 1)),
    updateRate: readNumber("update-rate", DEFAULTS.updateRate, 0.0001),
    bins: Math.round(readNumber("bins", DEFAULTS.bins, 2)),
    operatingHours: readNumber("operating-hours", DEFAULTS.operatingHours, 1),
    cpuFrequencyMhz: readNumber("cpu-frequency", DEFAULTS.cpuFrequencyMhz, 0.1),
    method: document.querySelector("#method").value,
    histFormat: document.querySelector("#hist-format").value,
    accFormat: document.querySelector("#acc-format").value,
    sampleFormat: document.querySelector("#sample-format").value,
    lutFormat: document.querySelector("#lut-format").value,
    zMax: readNumber("z-max", DEFAULTS.zMax, 0.1),
    nu: readNumber("nu", DEFAULTS.nu, 2.1),
    useLut: document.querySelector("#use-lut").checked,
    storeR: document.querySelector("#store-r").checked,
    memoryBudgetKb: readNumber("memory-budget", DEFAULTS.memoryBudgetKb, 0.01),
    cpuBudgetPercent: readNumber("cpu-budget", DEFAULTS.cpuBudgetPercent, 0.000001),
    cyclesClassification: readNumber("cycles-classification", DEFAULTS.cyclesClassification),
    cyclesHistIncrement: readNumber("cycles-hist-increment", DEFAULTS.cyclesHistIncrement),
    cyclesLutRead: readNumber("cycles-lut-read", DEFAULTS.cyclesLutRead),
    cyclesDirectTransform: readNumber("cycles-direct-transform", DEFAULTS.cyclesDirectTransform),
    cyclesSumZ: readNumber("cycles-sum-z", DEFAULTS.cyclesSumZ),
    cyclesCrossProduct: readNumber("cycles-cross-product", DEFAULTS.cyclesCrossProduct),
    cyclesTExtra: readNumber("cycles-t-extra", DEFAULTS.cyclesTExtra),
  };
}

function calculatePairCount(signals) {
  return (signals * (signals + 1)) / 2;
}

function calculateHistogramMemory(inputs) {
  return inputs.signals * inputs.bins * FORMATS[inputs.histFormat].bytes;
}

function calculateCopulaMemory(inputs, method) {
  if (method === "histogram") {
    return {
      sumZ: 0,
      sumZZ: 0,
      lut: 0,
      rMatrix: 0,
      nu: 0,
      total: 0,
    };
  }

  const accumulatorBytes = FORMATS[inputs.accFormat].bytes;
  const pairCount = calculatePairCount(inputs.signals);
  const sumZ = inputs.signals * accumulatorBytes;
  const sumZZ = pairCount * accumulatorBytes;
  const lut = inputs.useLut
    ? inputs.signals * inputs.bins * FORMATS[inputs.lutFormat].bytes
    : 0;
  const rMatrix = inputs.storeR ? pairCount * FORMATS.float32.bytes : 0;
  const nu = method === "t" ? FORMATS.float32.bytes : 0;

  return {
    sumZ,
    sumZZ,
    lut,
    rMatrix,
    nu,
    total: sumZ + sumZZ + lut + rMatrix + nu,
  };
}

function calculateMemory(inputs, method) {
  const histograms = calculateHistogramMemory(inputs);
  const sampleCounter = FORMATS[inputs.sampleFormat].bytes;
  const copula = calculateCopulaMemory(inputs, method);
  const components = {
    histograms,
    sampleCounter,
    sumZ: copula.sumZ,
    sumZZ: copula.sumZZ,
    lut: copula.lut,
    rMatrix: copula.rMatrix,
    nu: copula.nu,
  };

  return {
    components,
    total: Object.values(components).reduce((sum, value) => sum + value, 0),
  };
}

function calculateUpdateCount(inputs) {
  return inputs.operatingHours * 3600 * inputs.updateRate;
}

function calculateCpuCycles(inputs, method) {
  const pairCount = calculatePairCount(inputs.signals);
  const histogram =
    inputs.signals * (inputs.cyclesClassification + inputs.cyclesHistIncrement);

  if (method === "histogram") {
    return {
      histogram,
      transform: 0,
      sumZ: 0,
      crossProducts: 0,
      tExtra: 0,
      total: histogram,
    };
  }

  const transform =
    inputs.signals *
    (inputs.useLut ? inputs.cyclesLutRead : inputs.cyclesDirectTransform);
  const sumZ = inputs.signals * inputs.cyclesSumZ;
  const crossProducts = pairCount * inputs.cyclesCrossProduct;
  const tExtra = method === "t" ? inputs.signals * inputs.cyclesTExtra : 0;

  return {
    histogram,
    transform,
    sumZ,
    crossProducts,
    tExtra,
    total: histogram + transform + sumZ + crossProducts + tExtra,
  };
}

function calculateCpuLoad(inputs, cyclesPerUpdate) {
  return (
    (cyclesPerUpdate * inputs.updateRate) /
    (inputs.cpuFrequencyMhz * 1_000_000) *
    100
  );
}

function checkLimit(value, limit) {
  if (value > limit) {
    return { level: "critical", label: "Exceeded", ratio: value / limit };
  }
  if (value > limit * 0.8) {
    return { level: "warning", label: "Review", ratio: value / limit };
  }
  return { level: "good", label: "Safe", ratio: value / limit };
}

function checkBudget(value, budget) {
  if (value > budget) {
    return { level: "critical", label: "Over budget", ratio: value / budget };
  }
  if (value > budget * 0.8) {
    return { level: "warning", label: "Review headroom", ratio: value / budget };
  }
  return { level: "good", label: "Within budget", ratio: value / budget };
}

function checkCounterOverflow(inputs, method, updates) {
  const histogramFormat = FORMATS[inputs.histFormat];
  const sampleFormat = FORMATS[inputs.sampleFormat];
  const accumulatorFormat = FORMATS[inputs.accFormat];
  const histogram = {
    name: "Histogram bin",
    projected: updates,
    limit: histogramFormat.limit,
    format: histogramFormat.label,
    ...checkLimit(updates, histogramFormat.limit),
  };
  const sampleCounter = {
    name: "Lifetime sample counter",
    projected: updates,
    limit: sampleFormat.limit,
    format: sampleFormat.label,
    ...checkLimit(updates, sampleFormat.limit),
  };

  let copula = {
    name: "Copula accumulators",
    projected: 0,
    limit: 0,
    format: "Not used",
    level: "neutral",
    label: "Not used",
    ratio: 0,
    note: "",
  };

  if (method !== "histogram") {
    const projectedMagnitude = updates * Math.max(inputs.zMax, inputs.zMax ** 2);
    copula = {
      name: "Copula accumulators",
      projected: projectedMagnitude,
      limit: accumulatorFormat.limit,
      format: accumulatorFormat.label,
      ...checkLimit(projectedMagnitude, accumulatorFormat.limit),
      note: "Conservative magnitude bound",
    };

    if (
      accumulatorFormat.kind === "float" &&
      projectedMagnitude > accumulatorFormat.precisionLimit
    ) {
      copula.level = copula.level === "critical" ? "critical" : "warning";
      copula.label = "Precision review";
      copula.note = `Finite range is sufficient; exact integer-like increments are not guaranteed above ${formatCompact(
        accumulatorFormat.precisionLimit
      )}.`;
    }
  }

  return { histogram, sampleCounter, copula };
}

function worstStatus(statuses) {
  return statuses.reduce(
    (worst, status) => (STATUS_RANK[status.level] > STATUS_RANK[worst.level] ? status : worst),
    { level: "neutral", label: "Not assessed" }
  );
}

function calculateMethodResult(inputs, method) {
  const memory = calculateMemory(inputs, method);
  const cycles = calculateCpuCycles(inputs, method);
  const cpuLoad = calculateCpuLoad(inputs, cycles.total);
  const updates = calculateUpdateCount(inputs);
  const overflow = checkCounterOverflow(inputs, method, updates);
  const memoryStatus = checkBudget(memory.total, inputs.memoryBudgetKb * 1024);
  const cpuStatus = checkBudget(cpuLoad, inputs.cpuBudgetPercent);
  const counterStatus = worstStatus([
    overflow.histogram,
    overflow.sampleCounter,
    overflow.copula,
  ]);
  const overallStatus = worstStatus([memoryStatus, cpuStatus, counterStatus]);

  return {
    method,
    memory,
    cycles,
    cpuLoad,
    updates,
    overflow,
    memoryStatus,
    cpuStatus,
    counterStatus,
    overallStatus,
  };
}

function calculateResults(inputs) {
  const methods = Object.fromEntries(
    METHOD_ORDER.map((method) => [method, calculateMethodResult(inputs, method)])
  );

  return {
    inputs,
    methods,
    selected: methods[inputs.method],
    pairCount: calculatePairCount(inputs.signals),
  };
}

function formatNumber(value, options = {}) {
  if (!Number.isFinite(value)) return "∞";
  const absolute = Math.abs(value);
  const maximumFractionDigits =
    options.maximumFractionDigits ?? (absolute < 10 && absolute % 1 !== 0 ? 3 : 0);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  }).format(value);
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "∞";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatBytes(bytes, preferredUnit = "auto") {
  const units = [
    { key: "B", size: 1 },
    { key: "kB", size: 1024 },
    { key: "MB", size: 1024 ** 2 },
    { key: "GB", size: 1024 ** 3 },
  ];
  let unit = units[0];

  if (preferredUnit === "auto") {
    if (bytes >= 1024 ** 3) unit = units[3];
    else if (bytes >= 1024 ** 2) unit = units[2];
    else if (bytes >= 1024) unit = units[1];
  } else {
    unit = units.find((candidate) => candidate.key === preferredUnit) ?? units[0];
  }

  const value = bytes / unit.size;
  return `${formatNumber(value, {
    maximumFractionDigits: value < 10 && unit.size > 1 ? 2 : 1,
  })} ${unit.key}`;
}

function formatPercent(value) {
  if (value === 0) return "0%";
  if (value < 0.001) return `${value.toExponential(2)}%`;
  if (value < 0.1) return `${formatNumber(value, { maximumFractionDigits: 4 })}%`;
  return `${formatNumber(value, { maximumFractionDigits: 2 })}%`;
}

function statusBadge(status) {
  return `<span class="status-badge status-${status.level}">${status.label}</span>`;
}

function setStatusElement(element, status) {
  element.className = `status-dot status-${status.level}`;
  element.textContent = status.label;
}

function renderSummary(results) {
  const { inputs, selected } = results;
  document.querySelector("#summary-memory").textContent = formatBytes(selected.memory.total);
  document.querySelector("#summary-memory-detail").textContent =
    `${formatNumber(selected.memory.total)} B · ${formatBytes(selected.memory.total, "kB")} · ` +
    `${formatNumber(selected.memoryStatus.ratio * 100, { maximumFractionDigits: 1 })}% of RAM budget`;
  setStatusElement(document.querySelector("#memory-status"), selected.memoryStatus);

  document.querySelector("#summary-cpu").textContent = formatPercent(selected.cpuLoad);
  document.querySelector("#summary-cpu-detail").textContent =
    `${formatNumber(selected.cycles.total)} cycles/update · ` +
    `${formatNumber(inputs.cpuFrequencyMhz)} MHz`;
  setStatusElement(document.querySelector("#cpu-status"), selected.cpuStatus);

  document.querySelector("#summary-updates").textContent = formatCompact(selected.updates);
  document.querySelector("#summary-update-detail").textContent =
    `${formatNumber(selected.updates)} updates over ${formatNumber(inputs.operatingHours)} h`;

  const counterText = getCounterRecommendation(inputs, selected);
  document.querySelector("#summary-counter").textContent = counterText.title;
  document.querySelector("#summary-counter-detail").textContent = counterText.detail;
  setStatusElement(document.querySelector("#counter-status"), selected.counterStatus);
}

function getCounterRecommendation(inputs, result) {
  const updates = result.updates;
  const validHistogram = ["uint16", "uint24", "uint32"].find(
    (format) => updates <= FORMATS[format].limit * 0.8
  );
  const histogramText = validHistogram
    ? `${validHistogram} recommended`
    : "Beyond uint32";

  if (inputs.method === "histogram") {
    return {
      title: validHistogram ?? "> uint32",
      detail: `${histogramText} for histogram bins`,
    };
  }

  const copula = result.overflow.copula;
  return {
    title: result.counterStatus.level === "critical" ? "Exceeded" : validHistogram ?? "> uint32",
    detail: `${histogramText} · Copula: ${copula.label}`,
  };
}

function renderDecision(results) {
  const { inputs, selected } = results;
  const panel = document.querySelector("#decision-panel");
  const status = selected.overallStatus;
  panel.className = `decision-panel status-panel-${status.level === "neutral" ? "good" : status.level}`;

  const titles = {
    good: `${METHODS[inputs.method].label} is plausible under the entered budgets`,
    warning: `${METHODS[inputs.method].label} needs an engineering review`,
    critical: `${METHODS[inputs.method].label} exceeds a modeled limit`,
    neutral: `${METHODS[inputs.method].label} assessment`,
  };
  document.querySelector("#decision-title").textContent = titles[status.level];

  const issues = [];
  if (selected.memoryStatus.level !== "good") {
    issues.push(`memory is ${formatNumber(selected.memoryStatus.ratio * 100, { maximumFractionDigits: 1 })}% of budget`);
  }
  if (selected.cpuStatus.level !== "good") {
    issues.push(`CPU is ${formatNumber(selected.cpuStatus.ratio * 100, { maximumFractionDigits: 1 })}% of budget`);
  }
  if (selected.overflow.histogram.level !== "good") {
    issues.push(`${inputs.histFormat} histogram counters need attention`);
  }
  if (selected.overflow.sampleCounter.level !== "good") {
    issues.push(`${inputs.sampleFormat} sample counter needs attention`);
  }
  if (
    inputs.method !== "histogram" &&
    selected.overflow.copula.level !== "good"
  ) {
    issues.push(`${inputs.accFormat} copula accumulators need attention`);
  }

  let text;
  if (status.level === "good") {
    text =
      `${formatBytes(selected.memory.total)} memory and ${formatPercent(selected.cpuLoad)} CPU ` +
      `remain below 80% of the entered budgets. Validate the cycle assumptions and numeric representation on target hardware before release.`;
  } else {
    text =
      `${issues.join("; ")}. Adjust the data types, update rate, signal count, or budgets and verify the result on target hardware.`;
  }
  document.querySelector("#decision-text").textContent = text;
}

function selectMemoryChartUnit(maximum) {
  if (maximum >= 1024 ** 2) return "MB";
  if (maximum >= 1024) return "kB";
  return "B";
}

function renderMemoryChart(results) {
  const values = METHOD_ORDER.map((method) => results.methods[method].memory.total);
  const maximum = Math.max(...values, 1);
  const unit = selectMemoryChartUnit(maximum);
  document.querySelector("#memory-chart-unit").textContent =
    unit === "B" ? "Bytes" : unit;

  const chart = document.querySelector("#memory-chart");
  chart.innerHTML = METHOD_ORDER.map((method) => {
    const memory = results.methods[method].memory;
    const segments = MEMORY_COMPONENTS.map((component) => {
      const value = memory.components[component.key];
      if (value <= 0) return "";
      return (
        `<div class="bar-segment" ` +
        `style="height:${(value / maximum) * 100}%;background:${component.color}" ` +
        `title="${component.label}: ${formatBytes(value)}"></div>`
      );
    }).join("");

    return `
      <div class="bar-column">
        <div class="bar-value">${formatBytes(memory.total, unit)}</div>
        <div class="bar-track">${segments}</div>
        <div class="bar-label">${METHODS[method].shortLabel}</div>
      </div>
    `;
  }).join("");

  document.querySelector("#memory-legend").innerHTML = MEMORY_COMPONENTS.map(
    (component) =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${component.color}"></span>${component.label}</span>`
  ).join("");
}

function renderCpuChart(results) {
  const values = METHOD_ORDER.map((method) => results.methods[method].cpuLoad);
  const maximum = Math.max(...values, 1e-12);
  const chart = document.querySelector("#cpu-chart");
  chart.innerHTML = METHOD_ORDER.map((method) => {
    const result = results.methods[method];
    const height = Math.max((result.cpuLoad / maximum) * 100, result.cpuLoad > 0 ? 0.8 : 0);
    return `
      <div class="bar-column">
        <div class="bar-value">${formatPercent(result.cpuLoad)}</div>
        <div class="bar-track">
          <div class="bar-segment" style="height:${height}%" title="${formatNumber(result.cycles.total)} cycles/update"></div>
        </div>
        <div class="bar-label">${METHODS[method].shortLabel}</div>
      </div>
    `;
  }).join("");

  document.querySelector("#cpu-chart-note").textContent =
    `${formatNumber(results.inputs.updateRate, { maximumFractionDigits: 4 })} Hz update rate · ` +
    `${formatNumber(results.inputs.cpuFrequencyMhz)} MHz CPU · ` +
    `${results.inputs.useLut ? "LUT transform" : "direct-transform cost assumption"}`;
}

function renderComparisonTable(results) {
  const body = document.querySelector("#comparison-table-body");
  body.innerHTML = METHOD_ORDER.map((method) => {
    const result = results.methods[method];
    const selectedClass = method === results.inputs.method ? "selected-row" : "";
    return `
      <tr class="${selectedClass}">
        <td><strong>${METHODS[method].label}</strong></td>
        <td>${formatBytes(result.memory.total)}</td>
        <td>${formatNumber(result.cycles.total)}</td>
        <td>${formatPercent(result.cpuLoad)}</td>
        <td>${METHODS[method].information}</td>
        <td>${statusBadge(result.overallStatus)}</td>
      </tr>
    `;
  }).join("");
}

function renderFormulaTable(results) {
  const { inputs, selected, pairCount } = results;
  const rows = [
    ["Histogram memory", "d · B · c_hist", formatBytes(selected.memory.components.histograms)],
    ["Matrix entries", "d · (d + 1) / 2", formatNumber(pairCount)],
  ];

  if (inputs.method !== "histogram") {
    rows.push(
      ["sum_z memory", "d · c_acc", formatBytes(selected.memory.components.sumZ)],
      ["sum_zz memory", "n_pairs · c_acc", formatBytes(selected.memory.components.sumZZ)],
      [
        "Transform LUT",
        inputs.useLut ? "d · B · c_lut" : "disabled",
        formatBytes(selected.memory.components.lut),
      ],
      [
        "Additional R matrix",
        inputs.storeR ? "n_pairs · c_R" : "disabled",
        formatBytes(selected.memory.components.rMatrix),
      ]
    );
  }

  if (inputs.method === "t") {
    rows.push(["Fixed ν storage", "c_ν", formatBytes(selected.memory.components.nu)]);
  }

  rows.push(
    [
      "Total memory",
      "histograms + counter + copula components",
      `${formatNumber(selected.memory.total)} B`,
    ],
    [
      "Lifetime updates",
      "hours · 3,600 · update_rate",
      formatNumber(selected.updates),
    ],
    [
      "Histogram cycles",
      "d · (classification + increment)",
      formatNumber(selected.cycles.histogram),
    ]
  );

  if (inputs.method !== "histogram") {
    rows.push(
      [
        "Transform cycles",
        `d · ${inputs.useLut ? "LUT_read" : "direct_transform"}`,
        formatNumber(selected.cycles.transform),
      ],
      ["sum_z cycles", "d · sum_z_update", formatNumber(selected.cycles.sumZ)],
      [
        "Cross-product cycles",
        "n_pairs · cross_product_update",
        formatNumber(selected.cycles.crossProducts),
      ]
    );
  }

  if (inputs.method === "t") {
    rows.push([
      "t-copula extra cycles",
      "d · t_extra",
      formatNumber(selected.cycles.tExtra),
    ]);
  }

  rows.push(
    ["Total cycles/update", "sum of active cycle blocks", formatNumber(selected.cycles.total)],
    [
      "CPU load",
      "cycles/update · rate / (MHz · 1,000,000) · 100",
      formatPercent(selected.cpuLoad),
    ]
  );

  document.querySelector("#formula-table-body").innerHTML = rows
    .map(
      ([block, formula, result]) =>
        `<tr><td><strong>${block}</strong></td><td><code>${formula}</code></td><td>${result}</td></tr>`
    )
    .join("");
}

function renderOverflowTable(results) {
  const checks = [
    results.selected.overflow.histogram,
    results.selected.overflow.sampleCounter,
  ];
  if (results.inputs.method !== "histogram") {
    checks.push(results.selected.overflow.copula);
  }

  document.querySelector("#overflow-table-body").innerHTML = checks
    .map((check) => {
      const limitText =
        check.format === "float32"
          ? `${formatCompact(check.limit)} finite (${formatCompact(FORMATS.float32.precisionLimit)} exact-int threshold)`
          : formatNumber(check.limit);
      return `
        <tr>
          <td><strong>${check.name}</strong><br><small>${check.format}</small></td>
          <td>${formatCompact(check.projected)}</td>
          <td>${limitText}</td>
          <td>${statusBadge(check)}</td>
        </tr>
      `;
    })
    .join("");
}

function niceMaximum(value) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let niceFraction;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * 10 ** exponent;
}

function buildLineChart({ series, xMaximum, yFormatter, xLabel, yLabel }) {
  const width = 720;
  const height = 330;
  const margin = { top: 48, right: 18, bottom: 48, left: 74 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allValues = series.flatMap((item) => item.points.map((point) => point.y));
  const yMaximum = niceMaximum(Math.max(...allValues, 1));
  const xScale = (x) => margin.left + ((x - 1) / Math.max(xMaximum - 1, 1)) * plotWidth;
  const yScale = (y) => margin.top + plotHeight - (y / yMaximum) * plotHeight;

  const yTicks = Array.from({ length: 5 }, (_, index) => (yMaximum / 4) * index);
  const xTicks = Array.from(new Set([1, Math.round(xMaximum / 4), Math.round(xMaximum / 2), Math.round((xMaximum * 3) / 4), xMaximum]))
    .sort((a, b) => a - b);

  const grid = yTicks
    .map((tick) => {
      const y = yScale(tick);
      return `
        <line class="chart-gridline" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"></line>
        <text class="chart-label" x="${margin.left - 10}" y="${y + 3}" text-anchor="end">${yFormatter(tick)}</text>
      `;
    })
    .join("");

  const xLabels = xTicks
    .map((tick) => {
      const x = xScale(tick);
      return `
        <line class="chart-axis" x1="${x}" y1="${height - margin.bottom}" x2="${x}" y2="${height - margin.bottom + 5}"></line>
        <text class="chart-label" x="${x}" y="${height - margin.bottom + 19}" text-anchor="middle">${tick}</text>
      `;
    })
    .join("");

  const lines = series
    .map((item) => {
      const points = item.points.map((point) => `${xScale(point.x)},${yScale(point.y)}`).join(" ");
      const last = item.points[item.points.length - 1];
      return `
        <polyline class="chart-line" stroke="${item.color}" points="${points}"></polyline>
        <circle class="chart-point" fill="${item.color}" cx="${xScale(last.x)}" cy="${yScale(last.y)}" r="4"></circle>
      `;
    })
    .join("");

  const legend = series
    .map(
      (item, index) => `
        <line x1="${margin.left + index * 144}" y1="19" x2="${margin.left + 18 + index * 144}" y2="19" stroke="${item.color}" stroke-width="3"></line>
        <text class="svg-legend-text" x="${margin.left + 25 + index * 144}" y="22">${item.label}</text>
      `
    )
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
      ${legend}
      ${grid}
      <line class="chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"></line>
      <line class="chart-axis" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}"></line>
      ${xLabels}
      ${lines}
      <text class="chart-label" x="${margin.left + plotWidth / 2}" y="${height - 8}" text-anchor="middle">${xLabel}</text>
      <text class="chart-label" transform="translate(14 ${margin.top + plotHeight / 2}) rotate(-90)" text-anchor="middle">${yLabel}</text>
    </svg>
  `;
}

function renderScalingCharts(results) {
  const xMaximum = Math.min(128, Math.max(24, results.inputs.signals * 2));
  const sampleSignals = Array.from(
    { length: Math.min(xMaximum, 48) },
    (_, index) => Math.round(1 + (index * (xMaximum - 1)) / (Math.min(xMaximum, 48) - 1))
  ).filter((value, index, array) => index === 0 || value !== array[index - 1]);

  const colors = {
    histogram: "#0a6c67",
    gaussian: "#2f69a4",
    t: "#d96b34",
  };

  const memorySeries = METHOD_ORDER.map((method) => ({
    label: METHODS[method].shortLabel,
    color: colors[method],
    points: sampleSignals.map((signals) => ({
      x: signals,
      y: calculateMemory({ ...results.inputs, signals }, method).total,
    })),
  }));
  const memoryMaximum = Math.max(
    ...memorySeries.flatMap((series) => series.points.map((point) => point.y))
  );
  const memoryUnit = selectMemoryChartUnit(memoryMaximum);
  const unitSize = memoryUnit === "MB" ? 1024 ** 2 : memoryUnit === "kB" ? 1024 : 1;
  document.querySelector("#memory-scale-unit").textContent =
    memoryUnit === "B" ? "Bytes" : memoryUnit;
  document.querySelector("#memory-scaling-chart").innerHTML = buildLineChart({
    series: memorySeries.map((series) => ({
      ...series,
      points: series.points.map((point) => ({ ...point, y: point.y / unitSize })),
    })),
    xMaximum,
    yFormatter: (value) => formatCompact(value),
    xLabel: "Signals (d)",
    yLabel: `Memory (${memoryUnit})`,
  });

  const cpuSeries = METHOD_ORDER.map((method) => ({
    label: METHODS[method].shortLabel,
    color: colors[method],
    points: sampleSignals.map((signals) => ({
      x: signals,
      y: calculateCpuCycles({ ...results.inputs, signals }, method).total,
    })),
  }));
  document.querySelector("#cpu-scaling-chart").innerHTML = buildLineChart({
    series: cpuSeries,
    xMaximum,
    yFormatter: (value) => formatCompact(value),
    xLabel: "Signals (d)",
    yLabel: "Cycles/update",
  });
}

function renderMethodologyExample(results) {
  const { bins, signals } = results.inputs;
  const fullCells = bins ** signals;
  const fullGridText = Number.isFinite(fullCells)
    ? formatCompact(fullCells)
    : "beyond numeric display range";
  document.querySelector("#full-grid-example").textContent =
    `${bins}^${signals} = ${fullGridText} cells · copula = ${formatNumber(results.pairCount)} entries`;
}

function renderAll() {
  const inputs = getInputs();
  const results = calculateResults(inputs);
  renderSummary(results);
  renderDecision(results);
  renderMemoryChart(results);
  renderCpuChart(results);
  renderComparisonTable(results);
  renderFormulaTable(results);
  renderOverflowTable(results);
  renderScalingCharts(results);
  renderMethodologyExample(results);
}

function resetForm() {
  document.querySelector("#signals").value = DEFAULTS.signals;
  document.querySelector("#update-rate").value = DEFAULTS.updateRate;
  document.querySelector("#bins").value = DEFAULTS.bins;
  document.querySelector("#operating-hours").value = DEFAULTS.operatingHours;
  document.querySelector("#cpu-frequency").value = DEFAULTS.cpuFrequencyMhz;
  document.querySelector("#method").value = DEFAULTS.method;
  document.querySelector("#hist-format").value = DEFAULTS.histFormat;
  document.querySelector("#acc-format").value = DEFAULTS.accFormat;
  document.querySelector("#sample-format").value = DEFAULTS.sampleFormat;
  document.querySelector("#lut-format").value = DEFAULTS.lutFormat;
  document.querySelector("#z-max").value = DEFAULTS.zMax;
  document.querySelector("#nu").value = DEFAULTS.nu;
  document.querySelector("#use-lut").checked = DEFAULTS.useLut;
  document.querySelector("#store-r").checked = DEFAULTS.storeR;
  document.querySelector("#memory-budget").value = DEFAULTS.memoryBudgetKb;
  document.querySelector("#cpu-budget").value = DEFAULTS.cpuBudgetPercent;
  document.querySelector("#cycles-classification").value = DEFAULTS.cyclesClassification;
  document.querySelector("#cycles-hist-increment").value = DEFAULTS.cyclesHistIncrement;
  document.querySelector("#cycles-lut-read").value = DEFAULTS.cyclesLutRead;
  document.querySelector("#cycles-direct-transform").value = DEFAULTS.cyclesDirectTransform;
  document.querySelector("#cycles-sum-z").value = DEFAULTS.cyclesSumZ;
  document.querySelector("#cycles-cross-product").value = DEFAULTS.cyclesCrossProduct;
  document.querySelector("#cycles-t-extra").value = DEFAULTS.cyclesTExtra;
  renderAll();
}

if (typeof document !== "undefined") {
  const form = document.querySelector("#model-form");
  const resetButton = document.querySelector("#reset-button");
  form.addEventListener("input", renderAll);
  form.addEventListener("change", renderAll);
  resetButton.addEventListener("click", resetForm);
  renderAll();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULTS,
    FORMATS,
    calculatePairCount,
    calculateHistogramMemory,
    calculateCopulaMemory,
    calculateMemory,
    calculateUpdateCount,
    calculateCpuCycles,
    calculateCpuLoad,
    checkCounterOverflow,
    calculateMethodResult,
    calculateResults,
  };
}
