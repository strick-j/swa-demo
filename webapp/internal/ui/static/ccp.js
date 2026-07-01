// Drives the Central Credential Provider (CCP / AIMWebService) page: pick one of
// four scenarios, run it, animate the lifecycle, and render the CCP request +
// a MASKED proof-of-retrieval. Scenarios 2 and 3 are EXPECTED denials, rendered
// as a successful demonstration of the auth / authz boundaries.
(function () {
  "use strict";

  const root = document.getElementById("ccp-root");
  const btn = document.getElementById("run-btn");
  const statusEl = document.getElementById("status");
  const timeline = document.getElementById("timeline");
  const descEl = document.getElementById("scenario-desc");
  const tabs = Array.from(document.querySelectorAll(".tab[data-scenario]"));

  const SCENARIOS = {
    "authorized": {
      label: "Run · Authorized retrieval",
      desc: "Valid client certificate, and a Safe this application IS permitted to read → the credential is returned.",
      expectFail: false,
    },
    "no-cert": {
      label: "Run · No certificate",
      desc: "The app connects WITHOUT a client certificate → CCP rejects it at the authentication layer (this denial is the point).",
      expectFail: true, layer: "authentication",
    },
    "denied": {
      label: "Run · Denied safe",
      desc: "Valid client certificate, but a Safe this application is NOT permitted to read → CCP denies it at the authorization layer.",
      expectFail: true, layer: "authorization",
    },
    "dual": {
      label: "Run · Dual account",
      desc: "Query a dual-account pair by custom property → CCP returns whichever account is ACTIVE. On rotation the other goes active — zero downtime, no app change.",
      expectFail: false,
    },
  };

  const RESULT_IDS = ["app-id", "cert-cn", "safe", "query", "account", "virtual-username", "dual-active", "masked"];
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

  function setFields(body) {
    const ccp = body.ccp || {};
    show("app-id", ccp.app_id);
    show("cert-cn", ccp.cert_cn || (active === "no-cert" ? "(none presented)" : "—"));
    show("safe", ccp.safe);
    show("query", ccp.query);
    show("account", ccp.account);
    show("virtual-username", ccp.virtual_username);
    show("dual-active", ccp.dual_active);
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
      (root.dataset.sim === "true" ? "  (simulated — no live CCP configured)" : "");
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.scenario === s));
    clearResults();
  }

  async function run() {
    const s = active;
    const meta = SCENARIOS[s];
    btn.disabled = true;
    setStatus("Calling AIMWebService…", "pending");
    timeline.innerHTML = "";
    try {
      const resp = await fetch("/api/ccp?scenario=" + encodeURIComponent(s), { method: "POST" });
      const body = await resp.json();
      if (!resp.ok) {
        setStatus("Error: " + (body.error || resp.status), "error");
        return;
      }
      await renderSteps(body.steps);
      setFields(body);
      if (body.retrieved) {
        setStatus(body.simulated ? "Retrieved ✓ (simulated)" : "Retrieved ✓", "ok");
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
