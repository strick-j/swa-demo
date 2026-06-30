// Drives the Secrets Manager (Conjur) page: tabs between authn-jwt and authn-iam
// (AWS STS), triggers a retrieval for the active mode, animates the lifecycle,
// and renders the workload identity + a MASKED proof-of-retrieval. Mode-specific
// config (service ids, paths) is read from #sm-root data attributes.
(function () {
  "use strict";

  const root = document.getElementById("sm-root");
  const btn = document.getElementById("run-btn");
  const statusEl = document.getElementById("status");
  const timeline = document.getElementById("timeline");
  const modeDesc = document.getElementById("mode-desc");
  const tabs = Array.from(document.querySelectorAll(".tab[data-mode]"));
  const ds = root.dataset;

  const RESULT_IDS = [
    "jwt-header", "jwt-claims", "jwt-token",
    "iam-arn", "iam-host", "iam-account", "iam-userid", "iam-region",
    "identity", "authn", "secret-name", "secret-masked",
  ];

  const MODES = {
    "conjur-jwt": {
      runLabel: "Retrieve secret via authn-jwt",
      simulated: ds.jwtSim === "true",
      describe() {
        const svc = ds.jwtService || "authn-jwt/<service>";
        const path = ds.jwtSecret || "data/secrets/demo-db-password";
        return "The workload presents a short-lived JWT-SVID (audience conjur) to Conjur " +
          svc + "; Conjur maps its claims to a host and returns an access token used to read " +
          path + ".";
      },
    },
    "conjur-iam": {
      runLabel: "Retrieve secret via authn-iam",
      simulated: ds.iamSim === "true",
      describe() {
        const svc = ds.iamService ? "authn-iam/" + ds.iamService : "authn-iam/<service>";
        const host = ds.iamHost || "data/aws/<host>";
        const path = ds.iamSecret || "data/secrets/demo-db-password";
        return "The workload signs sts:GetCallerIdentity with its IAM role and posts it to Conjur " +
          svc + "; Conjur verifies the caller ARN, maps it to host " + host +
          ", and returns an access token used to read " + path + ".";
      },
    },
  };

  let activeMode = "conjur-jwt";

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status " + (kind || "");
  }
  function show(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  async function renderSteps(steps) {
    timeline.innerHTML = "";
    for (const step of steps || []) {
      const li = document.createElement("li");
      li.className = "step" + (step.status === "error" ? " error" : "");
      const meta = step.meta ? '<div class="meta">' + esc(step.meta) + "</div>" : "";
      li.innerHTML =
        '<span class="dot"></span>' +
        "<div><strong>" + esc(step.name) + "</strong>" +
        '<div class="detail">' + esc(step.detail) + "</div>" + meta + "</div>";
      timeline.appendChild(li);
      await new Promise((r) => setTimeout(r, 200));
      li.classList.add("done");
    }
  }

  // setFields renders the shared result plus both mode-specific panels; the
  // inactive panel is hidden, so writing all fields is harmless.
  function setFields(body) {
    show("identity", body.identity || "—");
    show("authn", body.auth_method || "—");
    show("secret-name", body.secret_name || "—");
    show("secret-masked", body.masked || "—");

    const jwt = body.jwt || {};
    show("jwt-header", jwt.header ? JSON.stringify(jwt.header, null, 2) : "—");
    show("jwt-claims", jwt.claims ? JSON.stringify(jwt.claims, null, 2) : "—");
    show("jwt-token", jwt.token || "—");

    const aws = body.aws || {};
    show("iam-arn", aws.caller_arn || "—");
    show("iam-host", aws.host_id || "—");
    show("iam-account", aws.account || "—");
    show("iam-userid", aws.user_id || "—");
    show("iam-region", aws.region || "—");
  }

  function clearResults() {
    timeline.innerHTML = "";
    RESULT_IDS.forEach((id) => show(id, "—"));
    setStatus("", "");
  }

  function selectMode(mode) {
    if (!MODES[mode]) return;
    activeMode = mode;
    btn.dataset.mode = mode;
    btn.textContent = MODES[mode].runLabel;
    modeDesc.textContent = MODES[mode].describe() +
      (MODES[mode].simulated ? "  (simulated — no live backend configured)" : "");
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
    document.querySelectorAll(".mode-panel").forEach((p) => {
      p.hidden = p.dataset.for !== mode;
    });
    clearResults();
  }

  async function run() {
    const mode = activeMode;
    btn.disabled = true;
    setStatus("Authenticating & retrieving…", "pending");
    timeline.innerHTML = "";
    try {
      const resp = await fetch("/api/retrieve?mode=" + encodeURIComponent(mode), { method: "POST" });
      const body = await resp.json();
      if (!resp.ok) {
        setStatus("Error: " + (body.error || resp.status), "error");
        return;
      }
      await renderSteps(body.steps);
      setFields(body);
      if (body.retrieved) {
        setStatus(body.simulated ? "Retrieved ✓ (simulated)" : "Retrieved ✓", "ok");
      } else {
        setStatus("Failed: " + (body.error || "not retrieved"), "error");
      }
    } catch (err) {
      setStatus("Request failed: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  tabs.forEach((t) => t.addEventListener("click", () => selectMode(t.dataset.mode)));
  btn.addEventListener("click", run);

  // Honor a deep link like /secrets-manager#conjur-iam; default to JWT.
  const initial = (location.hash || "").replace("#", "");
  selectMode(MODES[initial] ? initial : "conjur-jwt");
})();
