# ECU Statistics Cost Explorer

A static, client-side GitHub Pages dashboard for comparing:

- 1D histograms
- 1D histograms with Gaussian copula accumulators
- 1D histograms with fixed-ν t-copula accumulators

The page estimates memory use, CPU load, lifetime update counts, counter range,
and scaling behavior. A configurable multi-method line plot can sweep signal
count, update rate, discretization, dependency method, histogram counter format,
or CPU frequency. Its result axis can show memory or CPU load on a linear or
logarithmic scale. All inputs and CPU cycle assumptions are editable.

## Run locally

No build step or package installation is required. Open `index.html` directly,
or serve the directory with any static HTTP server:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>.

Run the calculation checks with:

```powershell
node tests/calculations.test.js
```

## Publish with GitHub Pages

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Select the `main` branch and the repository root (`/`).
5. Save the configuration.

GitHub will publish `index.html` without a build workflow.

## Model boundaries

This is a transparent planning model, not an implementation of copula fitting
and not a hardware benchmark. It does not model historical raw-data storage,
live estimation of t-copula degrees of freedom, NVM wear leveling, AUTOSAR
integration, or scheduling overhead. Cycle values and numeric representations
must be validated on the target ECU.
