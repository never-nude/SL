(function () {
  function updateModeLink() {
    var store = window.SL_Storage;
    if (!store || typeof store.getSessionMode !== "function") return;

    var mode = store.getSessionMode();
    var label = mode === "profile" ? "Profile" : "Guest";

    var el = document.getElementById("slMode") || document.querySelector('a[href^="entry.html"]');
    if (!el) return;

    el.textContent = label;
    el.title = "Mode";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateModeLink);
  } else {
    updateModeLink();
  }
})();
