import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ProcessMetricCollector,
  DEFAULT_INTERVAL_MS,
  readSample,
  cpuDelta,
} from '../src/core.js';

// Most tests use a fake clock so we never touch wall-clock time. The fake is
// a simple counter incremented by a fixed amount per call.
function makeClock(start = 1_700_000_000_000, step = 1000) {
  let t = start;
  return () => {
    const now = t;
    t += step;
    return now;
  };
}

test('readSample returns timestamp, memory, and cpu with expected types', () => {
  const clock = makeClock();
  const s = readSample(clock);

  assert.equal(typeof s.timestamp, 'number');
  assert.equal(s.timestamp, 1_700_000_000_000);

  assert.equal(typeof s.memory.rss, 'number');
  assert.ok(s.memory.rss >= 0);
  assert.equal(typeof s.memory.heapTotal, 'number');
  assert.equal(typeof s.memory.heapUsed, 'number');
  assert.equal(typeof s.memory.external, 'number');
  assert.equal(typeof s.memory.arrayBuffers, 'number');

  assert.equal(typeof s.cpu.user, 'number');
  assert.equal(typeof s.cpu.system, 'number');
  assert.ok(s.cpu.user >= 0);
  assert.ok(s.cpu.system >= 0);
});

test('readSample defaults to Date.now when no clock is supplied', () => {
  const before = Date.now();
  const s = readSample();
  const after = Date.now();

  assert.ok(s.timestamp >= before && s.timestamp <= after);
});

test('cpuDelta subtracts prev from curr', () => {
  const prev = { user: 1000, system: 500 };
  const curr = { user: 1500, system: 900 };
  assert.deepEqual(cpuDelta(prev, curr), { user: 500, system: 400 });
});

test('cpuDelta clamps negative deltas to zero (OS counter recycling)', () => {
  const prev = { user: 5000, system: 3000 };
  const curr = { user: 1000, system: 500 };
  assert.deepEqual(cpuDelta(prev, curr), { user: 0, system: 0 });
});

test('DEFAULT_INTERVAL_MS is 1000', () => {
  assert.equal(DEFAULT_INTERVAL_MS, 1000);
});

test('constructor rejects non-positive interval', () => {
  assert.throws(() => new ProcessMetricCollector({ intervalMs: 0 }), RangeError);
  assert.throws(() => new ProcessMetricCollector({ intervalMs: -5 }), RangeError);
});

test('constructor rejects non-finite interval', () => {
  assert.throws(() => new ProcessMetricCollector({ intervalMs: NaN }), RangeError);
  assert.throws(() => new ProcessMetricCollector({ intervalMs: Infinity }), RangeError);
});

test('constructor accepts a custom clock', () => {
  const clock = makeClock(42, 0);
  const c = new ProcessMetricCollector({ clock, intervalMs: 10 });
  c.on('metrics', (e) => {
    assert.equal(e.timestamp, 42);
    // stop immediately so the test doesn't keep ticking
    c.stop();
  });
  c.start();
});

test('isRunning is false before start and after stop', () => {
  const c = new ProcessMetricCollector({ intervalMs: 1000 });
  assert.equal(c.isRunning(), false);
  c.start();
  assert.equal(c.isRunning(), true);
  c.stop();
  assert.equal(c.isRunning(), false);
});

test('start is idempotent: calling twice does not create two timers', () => {
  const c = new ProcessMetricCollector({ intervalMs: 1000 });
  c.start();
  const first = c._timer;
  c.start();
  assert.equal(c._timer, first, 'second start() must not replace the timer');
  c.stop();
});

test('stop is a no-op when not running', () => {
  const c = new ProcessMetricCollector({ intervalMs: 1000 });
  assert.doesNotThrow(() => c.stop());
  assert.equal(c.isRunning(), false);
});

test('first emitted event has cpuDelta null (no prior baseline)', () => {
  const c = new ProcessMetricCollector({ intervalMs: 1000 });
  let received = null;
  c.on('metrics', (e) => {
    if (received === null) received = e;
    c.stop();
  });
  c.start();

  assert.equal(received.cpuDelta, null);
  assert.equal(typeof received.cpu.user, 'number');
  assert.equal(typeof received.memory.rss, 'number');
});

test('second emitted event has a real cpuDelta object', () => {
  const c = new ProcessMetricCollector({ intervalMs: 1000 });
  const events = [];
  c.on('metrics', (e) => {
    events.push(e);
    if (events.length === 2) c.stop();
  });
  c.start();

  // Drive the next tick: we call _tick() directly here rather than sleeping,
  // so the test is deterministic and fast.
  c._tick();

  assert.equal(events.length, 2);
  assert.equal(events[0].cpuDelta, null);
  assert.equal(typeof events[1].cpuDelta.user, 'number');
  assert.equal(typeof events[1].cpuDelta.system, 'number');
  assert.ok(events[1].cpuDelta.user >= 0);
  assert.ok(events[1].cpuDelta.system >= 0);
});

test('emitted event exposes the memory snapshot fields', () => {
  const c = new ProcessMetricCollector({ intervalMs: 1000 });
  let received = null;
  c.on('metrics', (e) => {
    received = e;
    c.stop();
  });
  c.start();

  assert.ok(Object.prototype.hasOwnProperty.call(received.memory, 'rss'));
  assert.ok(Object.prototype.hasOwnProperty.call(received.memory, 'heapTotal'));
  assert.ok(Object.prototype.hasOwnProperty.call(received.memory, 'heapUsed'));
  assert.ok(Object.prototype.hasOwnProperty.call(received.memory, 'external'));
  assert.ok(Object.prototype.hasOwnProperty.call(received.memory, 'arrayBuffers'));
});
