# Equipment catalogue micro-benchmarks

`equipment-stable-catalogue-benchmark.html` compares two browse-only DOM paths over 1,138 lightweight equipment rows:

- a replacement-shaped 36-row result window, including filter and count markup;
- a stable fixed-height canvas with synchronous real-row coverage and animation-frame overscan.

Build the module, serve the repository root over HTTP, and open the benchmark page in Chrome. The JSON result is rendered on the page and exposed as `window.__equipmentStableBenchmark` for browser automation.

This is an isolated DOM A/B, not a release gate. It intentionally excludes compendium access, PF2E preparation, Foundry's rendering backend, transaction preparation, and apply. `nextFrameLatency` mostly measures browser frame cadence. `rapidBurst` is an uncoalesced stress case, not a claim that the current scheduler commits every intermediate window. Qualifying the integrated design still requires the Foundry equipment profile and live transaction-authority gates.
