# Process Metric Collector

Polls `process.memoryUsage()` and `process.cpuUsage()` at a fixed interval and emits the combined reading as a structured `'metrics'` event.

```js
import { ProcessMetricCollector } from 'process-metric-collector';

const collector = new ProcessMetricCollector({ intervalMs: 1000 });

collector.on('metrics', (event) => {
  console.log(event.timestamp, event.memory.rss, event.cpuDelta);
});

collector.start();
// ...later
collector.stop();
```

`event` is `{ timestamp, memory, cpu, cpuDelta }`. `timestamp` is epoch milliseconds. `memory` is the value returned by `process.memoryUsage()` (`rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers`). `cpu` is the value returned by `process.cpuUsage()` (cumulative `user`/`system` microseconds). `cpuDelta` is the CPU consumed since the previous tick.

## Why this exists

Node gives you the raw primitives (`process.memoryUsage`, `process.cpuUsage`) but no glue. This library is that glue: a tiny `EventEmitter` subclass that ticks on a `setInterval`, snapshots both calls, computes the per-interval CPU delta, and emits one object. It is deliberately small — if you need aggregation, histograms, or export to a metrics backend, wire the `'metrics'` handler to whatever does that.

The trade-off: `cpuUsage` is cumulative, so the first emitted tick has no previous reading to subtract. Rather than fabricate a zero delta (which would hide that the baseline is arbitrary), `cpuDelta` is `null` on the first event. Check for `null` before doing arithmetic on it.

The timer is `unref`'d so it will not keep a process alive on its own.

## Exports

- `ProcessMetricCollector` — the class. Constructor options: `{ intervalMs?: number, clock?: () => number }`. Methods: `start()`, `stop()`, `isRunning()`, plus inherited `EventEmitter` methods.
- `DEFAULT_INTERVAL_MS` — `1000`.

ESM only. No third-party dependencies.
