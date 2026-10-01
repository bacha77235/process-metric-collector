import { ProcessMetricCollector, DEFAULT_INTERVAL_MS } from './core.js';

/**
 * Public entry point.
 *
 * Only `ProcessMetricCollector` and `DEFAULT_INTERVAL_MS` are considered the
 * stable API; `core.js` exports more for testing, but relying on those names
 * from outside the library is unsupported.
 */
export { ProcessMetricCollector, DEFAULT_INTERVAL_MS };
