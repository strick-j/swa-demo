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
      li.innerHTML =
        '<span class="dot"></span>' +
        '<div><strong>' + step.name + "</strong>" +
        '<div class="detail">' + step.detail + "</div></div>";
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
})();
