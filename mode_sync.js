(function () {
  function updateModeLink() {
    var store = window.SL_Storage;
    var account = window.SL_Account;
    if (!store || typeof store.getSessionMode !== "function") return;

    var mode = store.getSessionMode();
    var profileName = account && typeof account.getName === "function" ? account.getName() : "";
    var label = mode === "profile" ? (profileName || "Profile") : "Guest";

    var el = document.getElementById("slMode") || document.querySelector('a[href^="entry.html"]');
    if (!el) return;

    el.textContent = label;
    el.title = mode === "profile" ? "Profile mode" : "Guest mode";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateModeLink);
  } else {
    updateModeLink();
  }
})();
