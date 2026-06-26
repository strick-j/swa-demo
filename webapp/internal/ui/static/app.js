// Drives the visual JWT-SVID demo: triggers a request, animates the lifecycle
// steps, then renders the SPIFFE ID, validity window, and decoded JWT.
(function () {
  "use strict";

  const btn = document.getElementById("request-btn");
  const statusEl = document.getElementById("status");
  const timeline = document.getElementById("timeline");

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status " + (kind || "");
  }

  function fmtTime(s) {
    try { return new Date(s).toLocaleString(); } catch (_) { return s; }
  }

  async function renderSteps(steps) {
    timeline.innerHTML = "";
    for (const step of steps) {
      const li = document.createElement("li");
      li.className = "step";
      const meta = step.meta ? '<div class="meta">' + step.meta + "</div>" : "";
      li.innerHTML =
        '<span class="dot"></span>' +
        '<div><strong>' + step.name + "</strong>" +
        '<div class="detail">' + step.detail + "</div>" +
        meta + "</div>";
      timeline.appendChild(li);
      // Stagger the reveal so the flow reads as a sequence.
      await new Promise((r) => setTimeout(r, 220));
      li.classList.add("done");
    }
  }

  function show(id, value) {
    document.getElementById(id).textContent = value;
  }

  async function requestSVID() {
    btn.disabled = true;
    setStatus("Requesting identity…", "pending");
    timeline.innerHTML = "";
    try {
      const resp = await fetch("/api/svid", { method: "POST" });
      const body = await resp.json();
      if (!resp.ok) {
        setStatus("Error: " + (body.detail || body.error || resp.status), "error");
        return;
      }
      await renderSteps(body.steps || []);
      show("spiffe-id", body.spiffe_id || "—");
      show("validity",
        "issued:  " + fmtTime(body.issued_at) + "\n" +
        "expires: " + fmtTime(body.expires_at));
      show("jwt-header", JSON.stringify(body.header, null, 2));
      show("jwt-claims", JSON.stringify(body.claims, null, 2));
      show("jwt-token", body.token || "—");
      setStatus("JWT-SVID issued ✓", "ok");
    } catch (err) {
      setStatus("Request failed: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", requestSVID);

  // --- Database access via SPIFFE mTLS -------------------------------------
  const dbBtn = document.getElementById("db-btn");
  const dbStatusEl = document.getElementById("db-status");

  function setDbStatus(text, kind) {
    if (!dbStatusEl) return;
    dbStatusEl.textContent = text;
    dbStatusEl.className = "status " + (kind || "");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function renderDbResult(prefix, r) {
    const idEl = document.getElementById(prefix + "-id");
    const bodyEl = document.getElementById(prefix + "-body");
    if (!idEl || !bodyEl) return;
    if (!r) {
      idEl.textContent = "(probe not deployed)";
      bodyEl.innerHTML = '<div class="detail">Deploy the unauthorized app to see the denied result.</div>';
      return;
    }
    idEl.textContent = r.spiffe_id || "";
    if (r.allowed) {
      const rows = r.rows || [];
      let html = '<div class="db-ok">✓ ' + rows.length + " rows read</div>";
      html += '<table class="rows"><thead><tr><th>Ref</th><th>Origin</th><th>Destination</th><th>Status</th><th>Carrier</th></tr></thead><tbody>';
      for (const row of rows) {
        html += "<tr><td>" + esc(row.ref) + "</td><td>" + esc(row.origin) + "</td><td>" +
          esc(row.destination) + "</td><td>" + esc(row.status) + "</td><td>" + esc(row.carrier) + "</td></tr>";
      }
      html += "</tbody></table>";
      bodyEl.innerHTML = html;
    } else {
      bodyEl.innerHTML = '<div class="db-deny">✗ denied — SPIFFE ID not authorized</div>' +
        '<pre class="mono">' + esc(r.error || "connection rejected") + "</pre>";
    }
  }

  async function requestDB() {
    dbBtn.disabled = true;
    setDbStatus("Connecting with X.509-SVID…", "pending");
    try {
      const resp = await fetch("/api/db", { method: "POST" });
      const body = await resp.json();
      renderDbResult("db-auth", body.authorized);
      renderDbResult("db-unauth", body.unauthorized);
      setDbStatus("Done ✓", "ok");
    } catch (err) {
      setDbStatus("Request failed: " + err.message, "error");
    } finally {
      dbBtn.disabled = false;
    }
  }

  if (dbBtn) dbBtn.addEventListener("click", requestDB);
})();
