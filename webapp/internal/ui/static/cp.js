// Drives the (local) Credential Provider page: pick one of four scenarios, run
// it against the host cp-bridge, animate the lifecycle, and render the CP request
// + a MASKED proof-of-retrieval. Scenarios 2 and 3 are EXPECTED denials, rendered
// as a successful demonstration of the auth (application-hash) / authz boundaries.
(function () {
  "use strict";

  const root = document.getElementById("cp-root");
  const btn = document.getElementById("run-btn");
  const statusEl = document.getElementById("status");
  const timeline = document.getElementById("timeline");
  const descEl = document.getElementById("scenario-desc");
  const tabs = Array.from(document.querySelectorAll(".tab[data-scenario]"));

  const SCENARIOS = {
    "authorized": {
      label: "Run · Authorized retrieval",
      desc: "A caller whose application hash IS registered on the App, reading a Safe it may access → the credential is returned.",
      expectFail: false,
    },
    "invalid-hash": {
      label: "Run · Invalid hash",
      desc: "The bridge runs a DIFFERENT jar whose hash is NOT registered on the Application → the CP rejects it at the application-authentication layer (this denial is the point).",
      expectFail: true, layer: "authentication",
    },
    "denied": {
      label: "Run · Denied safe",
      desc: "A registered caller, but a Safe this Application is NOT permitted to read → the CP denies it at the authorization layer.",
      expectFail: true, layer: "authorization",
    },
    "dual": {
      label: "Run · Dual account",
      desc: "A registered caller queries a dual-account pair → the CP returns whichever account is ACTIVE. On rotation the other goes active — zero downtime, no app change.",
      expectFail: false,
    },
  };

  const RESULT_IDS = ["app-id", "app-hash", "caller", "safe", "query", "account", "virtual-username", "dual-active", "masked"];
  let active = "authorized";

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status " + (kind || "");
  }
  function show(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value && String(value).length ? value : "—";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

  function caller(cp) {
    const parts = [];
    if (cp.caller_path) parts.push(cp.caller_path);
    if (cp.os_user) parts.push("(" + cp.os_user + ")");
    return parts.join(" ");
  }

  function setFields(body) {
    const cp = body.cp || {};
    show("app-id", cp.app_id);
    show("app-hash", cp.app_hash || (active === "invalid-hash" ? "(unregistered hash)" : "—"));
    show("caller", caller(cp));
    show("safe", cp.safe);
    show("query", cp.query);
    show("account", cp.account);
    show("virtual-username", cp.virtual_username);
    show("dual-active", cp.dual_active);
    show("masked", body.masked);
  }

  function clearResults() {
    timeline.innerHTML = "";
    RESULT_IDS.forEach((id) => show(id, "—"));
    setStatus("", "");
  }

  function selectScenario(s) {
    if (!SCENARIOS[s]) return;
    active = s;
    btn.dataset.scenario = s;
    btn.textContent = SCENARIOS[s].label;
    descEl.textContent = SCENARIOS[s].desc +
      (root.dataset.live === "true" ? "" : "  (not configured — set CP_BRIDGE_URL on the host)");
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.scenario === s));
    clearResults();
  }

  async function run() {
    const s = active;
    const meta = SCENARIOS[s];
    btn.disabled = true;
    setStatus("Asking the host cp-bridge…", "pending");
    timeline.innerHTML = "";
    try {
      const resp = await fetch("/api/cp?scenario=" + encodeURIComponent(s), { method: "POST" });
      const body = await resp.json();
      if (!resp.ok) {
        setStatus("Error: " + (body.error || resp.status), "error");
        return;
      }
      await renderSteps(body.steps);
      setFields(body);
      if (body.retrieved) {
        setStatus("Retrieved ✓", "ok");
      } else if (meta.expectFail) {
        // The denial IS the demonstration — render it as a pass.
        setStatus("Denied at the " + meta.layer + " layer ✓ — expected", "ok");
      } else {
        setStatus("Failed: " + (body.error || "not retrieved"), "error");
      }
    } catch (err) {
      setStatus("Request failed: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  tabs.forEach((t) => t.addEventListener("click", () => selectScenario(t.dataset.scenario)));
  btn.addEventListener("click", run);
  selectScenario("authorized");
})();
