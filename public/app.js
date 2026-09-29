// Minimal, dependency-free chat client for the Cloudflare AI Agent.

// A stable per-browser session id => a dedicated Agent (Durable Object) instance,
// which is where this conversation's memory lives.
const SESSION_KEY = "cf-agent-session";
let session = localStorage.getItem(SESSION_KEY);
if (!session) {
  session = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, session);
}
const BASE = `/agents/chat-agent/${session}`;

const $messages = document.getElementById("messages");
const $form = document.getElementById("form");
const $input = document.getElementById("input");
const $send = document.getElementById("send");
const $clear = document.getElementById("clearBtn");
const $badge = document.getElementById("stateBadge");

const AVATARS = { user: "🧑", assistant: "🤖", system: "⚙️" };

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Very small markdown: **bold** + line breaks. Everything is escaped first.
function render(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function addMessage(role, text = "") {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = AVATARS[role] ?? "❓";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = render(text);

  wrap.append(avatar, bubble);
  clearEmptyState();
  $messages.appendChild(wrap);
  scrollToBottom();
  return bubble;
}

function scrollToBottom() {
  $messages.scrollTop = $messages.scrollHeight;
}

function clearEmptyState() {
  const empty = $messages.querySelector(".empty");
  if (empty) empty.remove();
}

function showEmptyState() {
  $messages.innerHTML = `
    <div class="empty">
      <h2>👋 Say hello</h2>
      <p>This assistant runs on <b>Llama 3.3</b> via Workers AI. Your conversation is
      stored in a per-session Durable Object.</p>
      <p>Try <code>/research the history of Cloudflare</code> to launch a durable Workflow.</p>
    </div>`;
}

function setBadge(count) {
  $badge.textContent = `memory: ${count} msg${count === 1 ? "" : "s"}`;
}

async function loadHistory() {
  try {
    const res = await fetch(`${BASE}/history`);
    const data = await res.json();
    $messages.innerHTML = "";
    if (!data.messages?.length) {
      showEmptyState();
    } else {
      for (const m of data.messages) addMessage(m.role, m.content);
    }
    setBadge(data.state?.messageCount ?? data.messages?.length ?? 0);
  } catch {
    showEmptyState();
  }
}

function setBusy(busy) {
  $send.disabled = busy;
  $input.disabled = busy;
  if (!busy) $input.focus();
}

async function sendChat(text) {
  addMessage("user", text);
  const bubble = addMessage("assistant", "");
  bubble.classList.add("blink");
  let full = "";

  try {
    const res = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = JSON.parse(line.slice(5).trim());
        if (payload.delta) {
          full += payload.delta;
          bubble.innerHTML = render(full);
          scrollToBottom();
        } else if (payload.error) {
          full += `\n\n⚠️ ${payload.error}`;
          bubble.innerHTML = render(full);
        }
      }
    }
  } catch (err) {
    bubble.innerHTML = render(`⚠️ Failed to reach the agent: ${err}`);
  } finally {
    bubble.classList.remove("blink");
  }
}

async function runResearch(topic) {
  addMessage("user", `/research ${topic}`);
  const bubble = addMessage("system", `🔬 Starting research Workflow on "${topic}"…`);

  try {
    const res = await fetch(`${BASE}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic }),
    });
    const { instanceId } = await res.json();
    if (!instanceId) throw new Error("No workflow instance id");

    const steps = ["queued", "running"];
    let dots = 0;
    while (true) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch(`${BASE}/research/${instanceId}`).then((r) => r.json());
      dots = (dots + 1) % 4;

      if (s.status === "complete") {
        bubble.innerHTML = render(`✅ Research Workflow complete. Saving to memory…`);
        await loadHistory();
        return;
      }
      if (s.status === "errored" || s.status === "terminated") {
        bubble.innerHTML = render(`⚠️ Workflow ${s.status}: ${s.error?.message ?? ""}`);
        return;
      }
      bubble.innerHTML = render(
        `🔬 Workflow "${topic}" — status: ${s.status}${".".repeat(dots)}`,
      );
    }
  } catch (err) {
    bubble.innerHTML = render(`⚠️ Research failed: ${err}`);
  }
}

$form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $input.value.trim();
  if (!text) return;
  $input.value = "";
  setBusy(true);

  const research = text.match(/^\/research\s+(.+)/i);
  if (research) {
    await runResearch(research[1].trim());
  } else {
    await sendChat(text);
  }

  await refreshBadge();
  setBusy(false);
});

$clear.addEventListener("click", async () => {
  await fetch(`${BASE}/history`, { method: "DELETE" });
  showEmptyState();
  setBadge(0);
  $input.focus();
});

async function refreshBadge() {
  try {
    const data = await fetch(`${BASE}/history`).then((r) => r.json());
    setBadge(data.state?.messageCount ?? data.messages?.length ?? 0);
  } catch {
    /* ignore */
  }
}

loadHistory();
