'use strict';

// The daemon's frame scheduler: one timer, aimed at the earliest thing that
// needs doing. Wakes (events, file changes, the heartbeat) pull it closer; a
// finished frame pushes it out to the next real deadline; a floor keeps our
// own token writes, which echo back as events, from scheduling frames forever.
//
// Every interval here is measured on a monotonic clock, never the wall clock.
// The floor used to compare `Date.now()` against the time of the last frame,
// and a wall clock stepped BACKWARDS — NTP correcting a fast RTC at boot, which
// is when this daemon starts — makes that difference negative: every wake then
// looks too soon after the last frame, is pushed out to a "last frame + 150ms"
// that now lies minutes in the future, and the panel stops drawing for as long
// as the step was, while the process answers pings and looks healthy. Reported
// in #18.
//
// Callers hand this DELAYS, not moments. The frame's own deadlines are wall
// clock times — they are compared with persisted activity stamps, which must
// stay wall clock — so they are turned into a delay at the call site, in the
// same instant the wall clock was read, and no step can fall in between.

function createScheduler({
  run,
  floorMs,
  pollMs,
  debounceMs,
  clock = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let nextAt = Infinity;
  let running = false;
  let rerun = false;
  let lastFrameAt = -Infinity;
  const bornAt = clock();

  const scheduleIn = (ms) => {
    const at = clock() + Math.max(0, ms);
    if (timer && at >= nextAt) return;
    if (timer) clearTimer(timer);
    nextAt = at;
    timer = setTimer(fire, Math.max(0, at - clock()));
  };

  const wake = () => scheduleIn(debounceMs);

  async function fire() {
    timer = null;
    nextAt = Infinity;
    if (running) {
      rerun = true;
      return;
    }
    const since = clock() - lastFrameAt;
    if (since < floorMs) {
      scheduleIn(pollMs - since);
      return;
    }
    running = true;
    lastFrameAt = clock();
    try {
      await run();
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        wake();
      }
    }
  }

  return {
    wake,
    scheduleIn,
    isRunning: () => running,
    // How long since a frame last started, or since this scheduler was made
    // if none has yet. The daemon reports it on `ping`, so the watchdog can
    // tell a process that is alive from one that is still drawing.
    frameAgeMs: () => clock() - Math.max(lastFrameAt, bornAt),
  };
}

module.exports = { createScheduler };
