(function () {
  var store = window.SL_Storage;
  if (!store) return;

  function returnTarget() {
    var q = null;
    try {
      q = new URLSearchParams(location.search).get("return") || "";
    } catch (e) {
      q = "";
    }

    if (q.indexOf("discover") === 0) return "discover.html";
    return "index.html";
  }

  function modeLabel(mode) {
    return mode === "profile" ? "Profile" : "Guest";
  }

  function renderStatus() {
    var el = document.getElementById("modeStatus");
    if (!el) return;

    var mode = store.getSessionMode();
    el.innerHTML = "Current mode: <span class=\"mono\">" + modeLabel(mode) + "</span>";
  }

  var guestBtn = document.getElementById("modeGuest");
  var profileBtn = document.getElementById("modeProfile");

  if (guestBtn) {
    guestBtn.addEventListener("click", function () {
      store.setSessionMode("guest");
      store.clearGuestSession();
      location.href = returnTarget();
    });
  }

  if (profileBtn) {
    profileBtn.addEventListener("click", function () {
      store.setSessionMode("profile");
      location.href = returnTarget();
    });
  }

  renderStatus();
})();
