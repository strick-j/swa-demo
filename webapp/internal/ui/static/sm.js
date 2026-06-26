// Drives the Secrets Manager (Conjur) page: triggers a retrieval, animates the
// lifecycle, and renders the workload identity + a MASKED proof-of-retrieval.
(function () {
  "use strict";

  const btn = document.getElementById("run-btn");
  const statusEl = document.getElementById("status");
  const timeline = document.getElementById("timeline");

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status " + (kind || "");
  }
  function show(id, value) {
    document.getElementById(id).textContent = value;
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

  async function run() {
    const mode = btn.dataset.mode || "conjur-jwt";
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
      show("identity", body.identity || "—");
      show("authn", body.auth_method || "—");
      show("secret-name", body.secret_name || "—");
      show("secret-masked", body.masked || "—");
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

  btn.addEventListener("click", run);
})();
