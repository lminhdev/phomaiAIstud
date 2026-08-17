/* ==========================================================
   LOCAL STUDY AI V3 — API EDITION
   - No WebLLM / no WebGPU / no model download
   - Local PDF/TXT parsing + local lexical RAG
   - OpenRouter OpenAI-compatible API
   - Streaming responses
   ========================================================== */
"use strict";

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
const PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// DÁN GROQ API KEY CỦA BẠN VÀO GIỮA HAI DẤU NGOẶC KÉP.
// Không commit file này lên repository công khai nếu key thật đang ở đây.
const GROQ_API_KEY = "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";

const CONFIG = {
  MAX_FILE_SIZE: 20 * 1024 * 1024,
  CHUNK_SIZE: 1100,
  CHUNK_OVERLAP: 150,
  TOP_K: 6,
  MAX_CONTEXT: 10000,
  MAX_HISTORY: 8,
  MAX_OUTPUT: 1400,
  DEFAULT_MODEL: "openai/gpt-oss-120b",
  DEFAULT_TEMP: 0.25
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let documents = loadJSON("localStudyDocuments", []);
let selectedDocumentId = localStorage.getItem("localStudySelectedDocument") || null;
let chatHistory = loadJSON("localStudyChat", []);
let apiKey = GROQ_API_KEY;
let model = CONFIG.DEFAULT_MODEL;
localStorage.setItem("localStudyGroqModel", model);
let temperature = Number(localStorage.getItem("localStudyTemperature") || CONFIG.DEFAULT_TEMP);
let abortController = null;


function enforceAutoModel() {
  model = CONFIG.DEFAULT_MODEL;
  localStorage.setItem("localStudyGroqModel", CONFIG.DEFAULT_MODEL);
  const select = $("#modelSelect");
  if (select) select.value = CONFIG.DEFAULT_MODEL;
}

const pages = {
  chat: $("#chatPage"),
  library: $("#libraryPage"),
  tools: $("#toolsPage")
};

const pageInfo = {
  chat: ["AI Chat", "RAG xử lý tài liệu local • AI trả lời qua API."],
  library: ["Library", "Tài liệu được đọc và tìm kiếm trực tiếp trên trình duyệt."],
  tools: ["Study Tools", "Công cụ học tập sử dụng API AI và tài liệu đang chọn."]
};

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn("localStorage:", e); }
}
function escapeHTML(text) {
  return String(text).replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function showToast(text) {
  const el = $("#toast"); if (!el) return;
  el.textContent = text; el.classList.add("show");
  clearTimeout(showToast.t); showToast.t = setTimeout(() => el.classList.remove("show"), 2800);
}
function setStatus(text, ok=false, busy=false) {
  const el = $("#aiStatus"); if (!el) return;
  el.innerHTML = `<span class="status-dot" style="background:${ok ? "#42d392" : busy ? "#f3b32e" : "#ff5f6d"}"></span>${escapeHTML(text)}`;
}

function switchPage(name) {
  $$(".nav").forEach(n => n.classList.toggle("active", n.dataset.page === name));
  Object.values(pages).forEach(p => p.classList.remove("active"));
  pages[name].classList.add("active");
  $("#pageTitle").textContent = pageInfo[name][0];
  $("#pageDescription").textContent = pageInfo[name][1];
}
$$(".nav").forEach(n => n.addEventListener("click", () => switchPage(n.dataset.page)));

function openSettings() {
  $("#modelSelect").value = CONFIG.DEFAULT_MODEL;
  model = CONFIG.DEFAULT_MODEL;
  localStorage.setItem("localStudyGroqModel", model);
  $("#temperature").value = temperature;
  $("#settingsModal").classList.remove("hidden");
}
$("#settingsBtn").addEventListener("click", openSettings);
$("#closeSettings").addEventListener("click", () => $("#settingsModal").classList.add("hidden"));
$("#settingsModal").addEventListener("click", e => {
  if (e.target.id === "settingsModal") e.target.classList.add("hidden");
});
$("#saveSettings").addEventListener("click", () => {
  model = CONFIG.DEFAULT_MODEL;
  $("#modelSelect").value = CONFIG.DEFAULT_MODEL;
  temperature = Math.max(0, Math.min(1, Number($("#temperature").value) || CONFIG.DEFAULT_TEMP));
  localStorage.setItem("localStudyGroqModel", model);
  localStorage.setItem("localStudyTemperature", String(temperature));
  $("#settingsModal").classList.add("hidden");
  setStatus(apiKey && !apiKey.startsWith("PASTE_") ? "Groq • GPT-OSS 120B" : "Chưa có API key", !!apiKey && !apiKey.startsWith("PASTE_"));
  showToast("Đã lưu cài đặt.");
});
$("#testApi").addEventListener("click", async () => {
  enforceAutoModel();
  const key = GROQ_API_KEY.trim();
  if (!key || key.startsWith("PASTE_")) return showToast("Hãy dán Groq API key vào đầu script.js.");
  try {
    setStatus("Đang kiểm tra Groq...", false, true);
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: CONFIG.DEFAULT_MODEL,
        messages: [{ role: "user", content: "Trả lời đúng một từ: OK" }],
        max_tokens: 8,
        temperature: 0
      })
    });
    if (!res.ok) throw new Error(await readApiError(res));
    setStatus("Groq • GPT-OSS 120B", true);
    showToast("Groq API hoạt động bình thường.");
  } catch (e) {
    setStatus("Groq API lỗi");
    showToast(e.message || "Không thể kết nối Groq API.");
  }
});

function normalizeText(text) {
  return String(text || "").replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function tokens(text) {
  return normalizeText(text).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, " ").split(/\s+/).filter(x => x.length > 1);
}
function chunkText(text, page = null) {
  const clean = normalizeText(text);
  const parts = clean.split(/\n\s*\n|(?<=[.!?])\s+(?=[A-ZÀ-Ỵ0-9])/u).filter(Boolean);
  const chunks = [];
  let buf = "";
  let startPage = page, endPage = page;
  for (const part of parts) {
    if ((buf + " " + part).length > CONFIG.CHUNK_SIZE && buf) {
      chunks.push({ text: buf.trim(), page: startPage, endPage });
      const tail = buf.slice(-CONFIG.CHUNK_OVERLAP);
      buf = tail + " " + part;
      startPage = page; endPage = page;
    } else {
      buf += (buf ? " " : "") + part;
    }
  }
  if (buf.trim()) chunks.push({ text: buf.trim(), page: startPage, endPage });
  return chunks;
}

function buildStats(chunks) {
  const df = Object.create(null);
  for (const c of chunks) {
    const seen = new Set(tokens(c.text));
    for (const t of seen) df[t] = (df[t] || 0) + 1;
  }
  return { df, total: chunks.length };
}
function getDF(stats, term) {
  if (!stats?.df) return 0;
  return stats.df instanceof Map ? Number(stats.df.get(term) || 0) : Number(stats.df[term] || 0);
}
function ensureStats(doc) {
  if (!doc.chunks?.length) return;
  if (!doc.stats || !doc.stats.df) doc.stats = buildStats(doc.chunks);
}
function scoreChunk(query, chunk, stats) {
  const q = tokens(query);
  const textTokens = tokens(chunk.text);
  const freq = Object.create(null);
  for (const t of textTokens) freq[t] = (freq[t] || 0) + 1;
  let score = 0;
  for (const term of q) {
    const tf = (freq[term] || 0) / Math.max(1, textTokens.length);
    const df = getDF(stats, term);
    const idf = Math.log((stats.total + 1) / (df + 1)) + 1;
    score += tf * idf;
    if (chunk.text.toLowerCase().includes(term)) score += 0.025;
  }
  const phrase = normalizeText(query).toLowerCase();
  if (phrase.length > 4 && chunk.text.toLowerCase().includes(phrase)) score += 1.5;
  return score;
}
function retrieve(query, docIds = null) {
  const docs = documents.filter(d => !docIds || docIds.includes(d.id));
  const all = [];
  for (const doc of docs) {
    ensureStats(doc);
    for (const chunk of doc.chunks || []) {
      all.push({
        ...chunk,
        docId: doc.id,
        docName: doc.name,
        score: scoreChunk(query, chunk, doc.stats)
      });
    }
  }
  all.sort((a,b) => b.score - a.score);
  return all.filter(x => x.score > 0).slice(0, CONFIG.TOP_K);
}
function buildContext(query) {
  const hits = retrieve(query, selectedDocumentId ? [selectedDocumentId] : null);
  if (!hits.length) return { text: "", citations: [] };
  let text = "", citations = [];
  hits.forEach((h, i) => {
    const tag = `[Nguồn ${i+1}: ${h.docName}${h.page ? `, trang ${h.page}${h.endPage && h.endPage !== h.page ? "-" + h.endPage : ""}` : ""}]`;
    const block = `${tag}\n${h.text}\n`;
    if (text.length + block.length <= CONFIG.MAX_CONTEXT) {
      text += block;
      citations.push({ n: i+1, docName: h.docName, page: h.page, text: h.text });
    }
  });
  return { text, citations };
}

async function getPdfLib() {
  if (!window.__pdfjs) {
    window.__pdfjs = await import(PDFJS_URL);
    window.__pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  }
  return window.__pdfjs;
}
async function readFile(file) {
  if (file.size > CONFIG.MAX_FILE_SIZE) throw new Error("File vượt quá 20 MB.");
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await getPdfLib();
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const text = content.items.map(x => x.str).join(" ");
      pages.push({ page: p, text: normalizeText(text) });
    }
    const chunks = pages.flatMap(x => chunkText(x.text, x.page));
    return { text: pages.map(x => x.text).join("\n\n"), chunks };
  }
  return { text: normalizeText(await file.text()), chunks: chunkText(await file.text()) };
}
async function addFile(file) {
  const data = await readFile(file);
  if (!data.text.trim()) throw new Error("Không đọc được nội dung văn bản.");
  const doc = {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    addedAt: Date.now(),
    text: data.text,
    chunks: data.chunks,
    stats: buildStats(data.chunks)
  };
  documents.unshift(doc);
  selectedDocumentId = doc.id;
  localStorage.setItem("localStudySelectedDocument", selectedDocumentId);
  saveJSON("localStudyDocuments", documents);
  renderLibrary();
  showToast(`Đã thêm ${file.name}`);
}
$("#fileInput").addEventListener("change", async e => {
  for (const file of [...e.target.files]) {
    try { await addFile(file); } catch (err) { showToast(`${file.name}: ${err.message}`); }
  }
  e.target.value = "";
});
["dragenter","dragover"].forEach(ev => $("#dropZone").addEventListener(ev, e => { e.preventDefault(); $("#dropZone").classList.add("drag"); }));
["dragleave","drop"].forEach(ev => $("#dropZone").addEventListener(ev, e => { e.preventDefault(); $("#dropZone").classList.remove("drag"); }));
$("#dropZone").addEventListener("drop", async e => {
  for (const file of [...e.dataTransfer.files]) {
    try { await addFile(file); } catch (err) { showToast(`${file.name}: ${err.message}`); }
  }
});

function renderLibrary() {
  documents.forEach(ensureStats);
  saveJSON("localStudyDocuments", documents);
  $("#fileCount").textContent = documents.length;
  $("#chunkCount").textContent = documents.reduce((n,d)=>n+(d.chunks?.length||0),0);
  $("#wordCount").textContent = documents.reduce((n,d)=>n+tokens(d.text).length,0).toLocaleString();
  $("#files").innerHTML = documents.length ? documents.map(d => `
    <div class="file-card ${d.id === selectedDocumentId ? "selected" : ""}" data-id="${d.id}">
      <div class="file-main"><span class="file-icon">${d.name.toLowerCase().endsWith(".pdf") ? "📕" : "📄"}</span>
      <div><b>${escapeHTML(d.name)}</b><small>${d.chunks?.length||0} chunks • ${(d.size/1024/1024).toFixed(2)} MB</small></div></div>
      <div class="file-actions"><button data-select="${d.id}">${d.id===selectedDocumentId?"✓ Đang chọn":"Chọn"}</button><button data-delete="${d.id}">🗑</button></div>
    </div>`).join("") : `<div class="empty">Chưa có tài liệu.</div>`;
  $$("#files [data-select]").forEach(b => b.addEventListener("click", () => selectDoc(b.dataset.select)));
  $$("#files [data-delete]").forEach(b => b.addEventListener("click", () => deleteDoc(b.dataset.delete)));
  updateActiveDoc();
}
function selectDoc(id) {
  selectedDocumentId = id;
  localStorage.setItem("localStudySelectedDocument", id);
  renderLibrary(); showToast("Đã chọn tài liệu.");
}
function deleteDoc(id) {
  const d = documents.find(x => x.id === id);
  if (!d || !confirm(`Xóa "${d.name}"?`)) return;
  documents = documents.filter(x => x.id !== id);
  if (selectedDocumentId === id) {
    selectedDocumentId = documents[0]?.id || null;
    if (selectedDocumentId) localStorage.setItem("localStudySelectedDocument", selectedDocumentId);
    else localStorage.removeItem("localStudySelectedDocument");
  }
  saveJSON("localStudyDocuments", documents); renderLibrary();
}
function updateActiveDoc() {
  const d = documents.find(x => x.id === selectedDocumentId);
  const el = $("#activeDoc");
  if (!d) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.classList.remove("hidden");
  el.innerHTML = `📚 <b>${escapeHTML(d.name)}</b> <span>• RAG đang ưu tiên tài liệu này</span>`;
}

function renderMarkdown(text) {
  return escapeHTML(text)
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}
function addMessage(role, text, meta="") {
  $("#welcome").style.display = "none";
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.innerHTML = `<div class="bubble">${role==="assistant" ? renderMarkdown(text) : escapeHTML(text)}</div>${meta ? `<small>${escapeHTML(meta)}</small>` : ""}`;
  $("#messages").appendChild(div);
  $("#chat").scrollTop = $("#chat").scrollHeight;
  return div.querySelector(".bubble");
}
function restoreChat() {
  $("#messages").innerHTML = "";
  if (!chatHistory.length) { $("#welcome").style.display = ""; return; }
  $("#welcome").style.display = "none";
  chatHistory.forEach(m => addMessage(m.role, m.content));
}
function saveChat() {
  chatHistory = chatHistory.slice(-CONFIG.MAX_HISTORY);
  saveJSON("localStudyChat", chatHistory);
}
$("#clearChat").addEventListener("click", () => {
  chatHistory = []; saveChat(); $("#messages").innerHTML = ""; $("#welcome").style.display = "";
});

function systemPrompt() {
  return `Bạn là Local Study AI, một trợ lý học tập.
- Trả lời bằng tiếng Việt trừ khi người dùng yêu cầu ngôn ngữ khác.
- Ưu tiên chính xác, rõ ràng, dễ học.
- Khi có CONTEXT từ tài liệu: chỉ khẳng định nội dung tài liệu khi context hỗ trợ. Nếu không đủ thông tin, nói rõ "Tài liệu hiện có không đủ thông tin để kết luận".
- Không bịa số trang, công thức, định nghĩa hoặc dữ kiện.
- Khi dùng context, ghi [Nguồn N] ở cuối câu/ý tương ứng nếu có thể.
- Không chép nguyên văn dài từ tài liệu; hãy giải thích bằng lời của bạn.
- Với bài toán, trình bày từng bước.
- Với quiz/flashcard, tạo nội dung rõ ràng và đáp án chính xác.`;
}
function makeMessages(userText, context) {
  const msgs = [{ role: "system", content: systemPrompt() }];
  const history = chatHistory.slice(-CONFIG.MAX_HISTORY);
  msgs.push(...history);
  const content = context.text
    ? `CÂU HỎI:\n${userText}\n\nCONTEXT TỪ TÀI LIỆU:\n${context.text}`
    : userText;
  msgs.push({ role: "user", content });
  return msgs;
}
async function readApiError(res) {
  try {
    const j = await res.json();
    return j?.error?.message || j?.message || `API HTTP ${res.status}`;
  } catch { return `API HTTP ${res.status}`; }
}
async function callAPI(messages, onToken) {
  if (!apiKey) {
    openSettings();
    throw new Error("Chưa có OpenRouter API key.");
  }

  enforceAutoModel();
  const requestedModel = CONFIG.DEFAULT_MODEL;
  abortController = new AbortController();

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      signal: abortController.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: requestedModel,
        messages,
        stream: true,
        temperature,
        max_tokens: CONFIG.MAX_OUTPUT
      })
    });

    if (!res.ok) {
      throw new Error(await readApiError(res));
    }

    if (!res.body) throw new Error("API không trả về stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", full = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const streamLines = buffer.split("\n");
      buffer = streamLines.pop() || "";

      for (let line of streamLines) {
        line = line.trim();
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;

        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            onToken(delta, full);
          }
        } catch {}
      }
    }

    return full.trim();
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new Error(e?.message || "Không thể kết nối API.");
  } finally {
    abortController = null;
  }
}

async function sendMessage(text) {
  enforceAutoModel();
  text = text.trim(); if (!text) return;
  if (!apiKey) { openSettings(); showToast("Hãy nhập OpenRouter API key."); return; }
  $("#input").value = ""; $("#send").disabled = true;
  addMessage("user", text);
  const context = buildContext(text);
  const assistantBubble = addMessage("assistant", "Đang suy nghĩ…");
  setStatus("Đang trả lời...", false, true);
  try {
    const answer = await callAPI(makeMessages(text, context), (delta, full) => {
      assistantBubble.innerHTML = renderMarkdown(full);
      $("#chat").scrollTop = $("#chat").scrollHeight;
    });
    if (!answer) throw new Error("Model không trả về nội dung.");
    chatHistory.push({ role: "user", content: text });
    chatHistory.push({ role: "assistant", content: answer });
    saveChat();
    if (context.citations.length) {
      const names = [...new Set(context.citations.map(c => c.docName))].join(", ");
      const meta = assistantBubble.parentElement.querySelector("small") || document.createElement("small");
      meta.textContent = `📚 RAG: ${names}`;
      if (!meta.parentElement) assistantBubble.parentElement.appendChild(meta);
    }
    setStatus(`API • ${model === "openai/gpt-oss-120b" ? "Free Router" : model.split("/").pop()}`, true);
  } catch (e) {
    assistantBubble.innerHTML = `<span class="error">❌ ${escapeHTML(e.message || "Không thể trả lời.")}</span>`;
    setStatus("API lỗi");
  } finally {
    abortController = null; $("#send").disabled = false;
  }
}
$("#send").addEventListener("click", () => sendMessage($("#input").value));
$("#input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage($("#input").value); }
});
$$("[data-prompt]").forEach(b => b.addEventListener("click", () => {
  $("#input").value = b.dataset.prompt; sendMessage(b.dataset.prompt);
}));

const TOOL_PROMPTS = {
  summary: "Tóm tắt tài liệu đang chọn thành các ý chính, thuật ngữ quan trọng và kết luận cần nhớ.",
  explain: "Giải thích nội dung tài liệu đang chọn như đang dạy một học sinh, từ cơ bản đến nâng cao.",
  quiz: "Tạo 10 câu trắc nghiệm từ tài liệu đang chọn, 4 đáp án A/B/C/D và ghi đáp án đúng ở cuối.",
  flashcard: "Tạo 15 flashcard dạng Hỏi — Đáp từ những kiến thức quan trọng nhất trong tài liệu.",
  outline: "Tạo dàn ý chi tiết của tài liệu đang chọn theo cấu trúc chương → mục → ý chính.",
  exam: "Tạo một đề ôn tập 15 câu gồm trắc nghiệm và tự luận dựa trên tài liệu đang chọn."
};
$$(".tool").forEach(b => b.addEventListener("click", () => {
  const prompt = TOOL_PROMPTS[b.dataset.tool];
  switchPage("chat");
  $("#input").value = prompt;
  sendMessage(prompt);
}));

function init() {
  enforceAutoModel();
  documents.forEach(ensureStats);
  saveJSON("localStudyDocuments", documents);
  renderLibrary();
  restoreChat();
  if (apiKey) setStatus(`API • ${model === "openai/gpt-oss-120b" ? "Free Router" : model.split("/").pop()}`, true);
  else setStatus("Groq chưa cấu hình");
}
init();
