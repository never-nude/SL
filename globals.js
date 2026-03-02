(function () {
  window.SL = window.SL || {};

  // Behavior tuning for Discover bridge logic.
  window.SL_FLAGS = window.SL_FLAGS || {};
  if (typeof window.SL_FLAGS.bridgeProb !== "number") window.SL_FLAGS.bridgeProb = 0.28;
  if (typeof window.SL_FLAGS.crossBias !== "number") window.SL_FLAGS.crossBias = 0.72;
  if (typeof window.SL_FLAGS.curveballProb !== "number") window.SL_FLAGS.curveballProb = 0.10;

  window.SL_UI = window.SL_UI || {
    fadeMs: 180
  };
})();
