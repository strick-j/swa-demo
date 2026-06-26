// Drives the three-scenario workload-identity switcher. One run fetches all
// three outcomes (trusted / untrusted / unknown); the tabs swap which one is
// shown: its lifecycle, SPIFFE ID, decoded JWT-SVID, and resource-access result.
(function () {
  "use strict";

  const runBtn = document.getElementById("run-btn");
  const statusEl = document.getElementById("status");
  const timeline = document.getElementById("timeline");
  const tabs = Array.from(document.querySelectorAll(".tab"));

  // Per-scenario copy for the header blurb.
  const BLURB = {
    trusted:
      "Registered in the SWA Server. Gets a JWT/X.509-SVID, and its SPIFFE ID is allow-listed at the database gateway — so the read succeeds.",
    untrusted:
      "A different namespace/service-account. It IS issued a valid SVID, but its SPIFFE ID is not allow-listed at the gateway — so the mTLS handshake is rejected before Postgres.",
    unknown:
      "No registration policy. It asks the Workload API like the others, but the SWA Server refuses to attest it — no SVID is ever issued, so nothing reaches the wire.",
  };

  let model = null; // { trusted, untrusted, unknown }
  let current = "trusted";

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status " + (kind || "");
  }

  function fmtTime(s) {
    if (!s) return "—";
    try { return new Date(s).toLocaleString(); } catch (_) { return s; }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function show(id, value) {
    document.getElementById(id).textContent = value;
  }

  // --- lifecycle rendering -------------------------------------------------
  async function renderSteps(steps, animate) {
    timeline.innerHTML = "";
    for (const step of steps) {
      const li = document.createElement("li");
      li.className = "step" + (step.status === "error" ? " error" : "");
      const meta = step.meta ? '<div class="meta">' + esc(step.meta) + "</div>" : "";
      li.innerHTML =
        '<span class="dot"></span>' +
        "<div><strong>" + esc(step.name) + "</strong>" +
        '<div class="detail">' + esc(step.detail) + "</div>" +
        meta + "</div>";
      timeline.appendChild(li);
      if (animate) await new Promise((r) => setTimeout(r, 200));
      li.classList.add("done");
    }
  }

  // The refusal lifecycle for a workload that is never issued an SVID. Derived
  // client-side from the probe error so the story still reads as a sequence.
  function refusalSteps(errText) {
    return [
      {
        name: "Workload request",
        detail:
          "The app holds no stored credential. It opens the SWA Agent Workload API and asks for a JWT-SVID for its audience.",
        meta: "unix:///tmp/swa-agent/public/api.sock",
        status: "ok",
      },
      {
        name: "Workload attestation",
        detail:
          "The agent identifies the calling pod from its Kubernetes attributes — namespace and service account.",
        meta: "k8s attestor · ns=swa-demo-rogue · sa=rogue-app",
        status: "ok",
      },
      {
        name: "Issuance refused",
        detail:
          "No node-group registration policy matches this workload, so the SWA Server will not attest it. No SVID is minted — the workload has no identity.",
        meta: errText || "PermissionDenied · no identity issued",
        status: "error",
      },
    ];
  }

  // --- resource (DB) rendering ---------------------------------------------
  function renderResource(scenario) {
    const el = document.getElementById("resource-body");
    const svid = scenario.svid || {};
    if (!svid.issued) {
      el.innerHTML =
        '<div class="db-deny">✗ no identity — the workload never reached the gateway</div>' +
        '<p class="detail">No SVID was issued, so no mTLS handshake was attempted. ' +
        "No token, no secret, no data on the wire. This is the trust boundary working: " +
        "an unregistered workload cannot present an identity the gateway would even evaluate.</p>";
      return;
    }
    const db = scenario.db;
    if (!db) {
      el.innerHTML = '<div class="detail">No database attempt for this scenario.</div>';
      return;
    }
    el.innerHTML = '<div class="meta">' + esc(db.spiffe_id || svid.result.spiffe_id || "") + "</div>" +
      resourceBody(db);
  }

  function resourceBody(db) {
    if (db.allowed) {
      const rows = db.rows || [];
      let html = '<div class="db-ok">✓ ' + rows.length + " rows read through the SPIFFE gateway</div>";
      html += '<table class="rows"><thead><tr><th>Ref</th><th>Origin</th><th>Destination</th>' +
        "<th>Status</th><th>Carrier</th></tr></thead><tbody>";
      for (const row of rows) {
        html += "<tr><td>" + esc(row.ref) + "</td><td>" + esc(row.origin) + "</td><td>" +
          esc(row.destination) + "</td><td>" + esc(row.status) + "</td><td>" + esc(row.carrier) + "</td></tr>";
      }
      return html + "</tbody></table>";
    }
    return '<div class="db-deny">✗ denied at the gateway — SPIFFE ID not allow-listed</div>' +
      '<p class="detail">The workload holds a valid SVID, but the gateway rejects it during the ' +
      "mTLS handshake because its URI SAN is not in the allow-list. Same CA, valid identity — " +
      "authorization is on the SPIFFE ID.</p>" +
      '<pre class="mono">' + esc(db.error || "connection rejected") + "</pre>";
  }

  // --- scenario switch -----------------------------------------------------
  async function renderScenario(key, animate) {
    current = key;
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.scenario === key));

    const scenario = model && model[key];
    document.getElementById("scenario-blurb").textContent = BLURB[key] || "";

    if (!scenario) {
      show("scenario-id", "—");
      return;
    }
    const svid = scenario.svid || {};
    if (svid.issued && svid.result) {
      const r = svid.result;
      show("scenario-id", r.spiffe_id || "—");
      await renderSteps(r.steps || [], animate);
      show("spiffe-id", r.spiffe_id || "—");
      show("validity", "issued:  " + fmtTime(r.issued_at) + "\nexpires: " + fmtTime(r.expires_at));
      show("jwt-header", JSON.stringify(r.header, null, 2));
      show("jwt-claims", JSON.stringify(r.claims, null, 2));
      show("jwt-token", r.token || "—");
    } else {
      show("scenario-id", "✗ no identity issued");
      await renderSteps(refusalSteps(svid.error), animate);
      show("spiffe-id", "— (no SVID issued)");
      show("validity", "—");
      show("jwt-header", "—");
      show("jwt-claims", "—");
      show("jwt-token", svid.error || "— (no token)");
    }
    renderResource(scenario);
  }

  async function run() {
    runBtn.disabled = true;
    setStatus("Requesting identities…", "pending");
    try {
      const resp = await fetch("/api/scenarios", { method: "POST" });
      const body = await resp.json();
      if (!resp.ok) {
        setStatus("Error: " + (body.detail || body.error || resp.status), "error");
        return;
      }
      model = body;
      setStatus("Done ✓", "ok");
      await renderScenario(current, true);
    } catch (err) {
      setStatus("Request failed: " + err.message, "error");
    } finally {
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener("click", run);
  tabs.forEach((t) =>
    t.addEventListener("click", () => renderScenario(t.dataset.scenario, false)));

  // Mark the default tab and auto-run once for immediacy.
  renderScenario("trusted", false);
  run();
})();
