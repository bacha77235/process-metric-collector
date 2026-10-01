/**
 * Process Metric Collector — polls `process.memoryUsage` and `process.cpuUsage`
 * at a fixed interval and emits the readings as a structured event.
 *
 * Design decisions:
 *
 * - ESM only, standard library only. No third-party deps so the test container
 *   needs no network access.
 *
 * - The API mirrors Node's `EventEmitter` (extend it) so consumers can use
 *   `.on('metrics', fn)` and `.off('metrics', fn)` with no extra learning
 *   cost. `start()`/`stop()` wrap `setInterval`/`clearInterval`.
 *
 * - `cpuUsage` is *cumulative* (microseconds of CPU time since process start).
 *   To give each tick an interpretable per-interval delta we store the
 *   previous reading and subtract. The *first* tick therefore has no previous
 *   reading; rather than fabricate a zero delta (which would hide that the
 *   baseline is arbitrary) we emit `cpuDelta: null` on the first sample and
 *   document it. This is the one awkward edge users will hit.
 *
 * - `timestamp` defaults to `Date.now` but is overridable via the `clock`
 *   option so tests can be deterministic.
 */

import { EventEmitter } from 'node:events';

export const DEFAULT_INTERVAL_MS = 1000;

/**
 * Read a fresh sample of process metrics.
 *
 * Kept as a module-level function (not a method) so it has no `this` binding
 * and can be used standalone or stubbed in tests without constructing a
 * collector.
 *
 * @param {() => number} [now] - Optional clock returning epoch milliseconds.
 * @returns {{timestamp: number, memory: NodeJS.MemoryUsage, cpu: NodeJS.CpuUsage}}
 */
export function readSample(now) {
  const timestamp = typeof now === 'function' ? now() : Date.now();
  return {
    timestamp,
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
  };
}

/**
 * Compute the per-tick CPU delta between two `cpuUsage` snapshots.
 *
 * `process.cpuUsage()` returns `{user, system}` in microseconds (integers).
 * Subtraction can in principle yield negative values if the OS recycles
 * counters; we clamp to zero so consumers don't see nonsense without having to
 * guard every read themselves.
 *
 * @param {NodeJS.CpuUsage} prev
 * @param {NodeJS.CpuUsage} curr
 * @returns {{user: number, system: number}}
 */
export function cpuDelta(prev, curr) {
  const user = Math.max(0, curr.user - prev.user);
  const system = Math.max(0, curr.system - prev.system);
  return { user, system };
}

/**
 * Shape emitted on the 'metrics' event.
 *
 * @typedef {Object} MetricEvent
 * @property {number} timestamp        Epoch milliseconds from `clock()`.
 * @property {NodeJS.MemoryUsage} memory Snapshot from `process.memoryUsage()`.
 * @property {NodeJS.CpuUsage} cpu      Cumulative CPU usage at this tick.
 * @property {{user: number, system: number} | null} cpuDelta
 *   Microseconds of CPU consumed since the previous tick. `null` on the very
 *   first tick because no previous baseline exists.
 */

/**
 * Polls `process.memoryUsage()` and `process.cpuUsage()` at a fixed interval
 * and emits a `'metrics'` event with the combined reading.
 */
export class ProcessMetricCollector extends EventEmitter {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.intervalMs=1000]  Poll interval in milliseconds.
   * @param {() => number} [opts.clock]      Custom clock for `timestamp`.
   */
 constructor({ intervalMs = DEFAULT_INTERVAL_MS, clock } = {}) {
    super();

    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(`intervalMs must be a positive finite number, got ${intervalMs}`);
    }

    this._intervalMs = intervalMs;
    this._clock = typeof clock === 'function' ? clock : Date.now;
    this._timer = null;
    this._prevCpu = null;
  }

  /**
   * Whether polling is currently running.
   * @returns {boolean}
   */
  isRunning() {
    return this._timer !== null;
  }

  /**
   * Begin polling. Emits the first 'metrics' event immediately, then every
   * `intervalMs`. Calling `start()` while already running is a no-op.
   *
   * @returns {this}
   */
  start() {
    if (this._timer !== null) return this;

    // Fire the first sample synchronously so consumers don't have to wait a
    // full interval to see something. Subsequent ticks use setInterval.
    this._tick();
    this._timer = setInterval(() => this._tick(), this._intervalMs);

    // Unref the timer so it doesn't keep the event loop alive on its own —
    // a background metrics collector shouldn't prevent process exit.
    if (typeof this._timer.unref === 'function') {
      this._timer.unref();
    }

    return this;
  }

  /**
   * Stop polling. Safe to call when not running.
   *
   * @returns {this}
   */
  stop() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this;
  }

  /**
   * Read one sample, compute the CPU delta if possible, and emit.
   * @private
   */
  _tick() {
    const sample = readSample(this._clock);
    let delta = null;
    if (this._prevCpu !== null) {
      delta = cpuDelta(this._prevCpu, sample.cpu);
    }
    this._prevCpu = sample.cpu;

    /** @type {MetricEvent} */
    const event = {
      timestamp: sample.timestamp,
      memory: sample.memory,
      cpu: sample.cpu,
      cpuDelta: delta,
    };
    this.emit('metrics', event);
  }
}
