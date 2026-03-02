(function () {
  var store = window.SL_Storage;
  var account = window.SL_Account;
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

  function profileName() {
    if (!account || typeof account.getName !== "function") return "";
    return account.getName() || "";
  }

  function modeLabel(mode) {
    if (mode !== "profile") return "Guest";
    var name = profileName();
    return name ? ("Profile · " + name) : "Profile";
  }

  function renderStatus() {
    var el = document.getElementById("modeStatus");
    if (!el) return;

    var mode = store.getSessionMode();
    el.innerHTML = "Current mode: <span class=\"mono\">" + modeLabel(mode) + "</span>";
  }

  function renderRegistration() {
    var input = document.getElementById("profileName");
    if (!input) return;

    var current = profileName();
    input.value = current || "pantz";
  }

  function setRegisterStatus(message) {
    var el = document.getElementById("registerStatus");
    if (!el) return;
    el.textContent = message || "";
  }

  function saveRegistration() {
    if (!account || typeof account.setName !== "function") return "";

    var input = document.getElementById("profileName");
    var candidate = input ? input.value : "";
    var saved = account.setName(candidate);

    if (!saved) {
      setRegisterStatus("Enter a profile name.");
      return "";
    }

    if (input) input.value = saved;
    setRegisterStatus("Saved: " + saved);
    return saved;
  }

  var guestBtn = document.getElementById("modeGuest");
  var profileBtn = document.getElementById("modeProfile");
  var registerBtn = document.getElementById("registerSave");

  if (account && typeof account.ensureName === "function") {
    account.ensureName("pantz");
  }

  if (guestBtn) {
    guestBtn.addEventListener("click", function () {
      store.setSessionMode("guest");
      store.clearGuestSession();
      location.href = returnTarget();
    });
  }

  if (profileBtn) {
    profileBtn.addEventListener("click", function () {
      var saved = profileName();
      if (!saved) saved = saveRegistration();
      if (!saved && account && typeof account.ensureName === "function") {
        saved = account.ensureName("pantz");
        setRegisterStatus(saved ? ("Saved: " + saved) : "Enter a profile name.");
      }
      store.setSessionMode("profile");
      location.href = returnTarget();
    });
  }

  if (registerBtn) {
    registerBtn.addEventListener("click", function () {
      saveRegistration();
      renderStatus();
    });
  }

  renderRegistration();
  renderStatus();
})();
