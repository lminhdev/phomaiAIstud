/* =========================================================
   LOCAL STUDY AI V1.1
   Fix PDF.js worker + safe document rendering
   ========================================================= */

"use strict";

/* ---------- WebLLM ---------- */
import { CreateMLCEngine } from
  "https://esm.run/@mlc-ai/web-llm";

/* ---------- PDF.js ---------- */
const pdfjsLib = await import(
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs"
);

/*
 * FIX QUAN TRỌNG:
 * PDF.js cần Worker để đọc PDF.
 */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

/* ---------- CONFIG ---------- */
const CONFIG = {
  MODEL: "SmolLM2-360M-Instruct-q4f16_1-MLC",
  CHUNK_SIZE: 700,
  CHUNK_OVERLAP: 100,
  TOP_K: 4,
  MAX_CONTEXT: 4500,
  MAX_HISTORY: 8,
  MAX_FILE_SIZE: 20 * 1024 * 1024,
  MAX_TOKENS: 500,
  TEMPERATURE: 0.5
};

/* ---------- STATE ---------- */
let engine = null;
let aiReady = false;
let loadingAI = false;
let selectedDocument = null;

let documents = loadDocuments();

/* ---------- DOM ---------- */
const $ = (selector) => window.document.querySelector(selector);
const $$ = (selector) => window.document.querySelectorAll(selector);

const navs = $$(".nav");

const pages = {
  chat: $("#chatPage"),
  library: $("#libraryPage"),
  tools: $("#toolsPage")
};

const pageTitle = $("#pageTitle");
const pageDescription = $("#pageDescription");
const messages = $("#messages");
const welcome = $("#welcome");
const input = $("#input");
const send = $("#send");
const aiStatus = $("#aiStatus");
const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const filesContainer = $("#files");
const fileCount = $("#fileCount");
const chunkCount = $("#chunkCount");
const toast = $("#toast");

/* ---------- PAGE INFO ---------- */
const pageInfo = {
  chat: {
    title: "AI Chat",
    description: "Trợ lý học tập AI local."
  },
  library: {
    title: "Library",
    description: "Tài liệu học tập của bạn."
  },
  tools: {
    title: "Study Tools",
    description: "Công cụ học tập bằng AI."
  }
};

/* ---------- NAVIGATION ---------- */
navs.forEach((nav) => {
  nav.addEventListener("click", () => {
    const page = nav.dataset.page;

    navs.forEach((item) => item.classList.remove("active"));
    nav.classList.add("active");

    Object.values(pages).forEach((pageEl) =>
      pageEl.classList.remove("active")
    );

    pages[page].classList.add("active");
    pageTitle.textContent = pageInfo[page].title;
    pageDescription.textContent = pageInfo[page].description;
  });
});

/* ---------- TOAST ---------- */
let toastTimer;

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

/* ---------- AI STATUS ---------- */
function setAIStatus(text, color = "#f5a623") {
  aiStatus.innerHTML = `
    <span class="status-dot"
      style="background:${color};box-shadow:0 0 10px ${color}">
    </span>
    ${escapeHTML(text)}
  `;
}

/* ---------- ESCAPE ---------- */
function escapeHTML(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- LOAD AI ---------- */
async function loadAI() {
  if (aiReady) return;
  if (loadingAI) return;

  loadingAI = true;
  setAIStatus("Đang tải AI...");
  showToast("Đang khởi động Local AI...");

  try {
    engine = await CreateMLCEngine(
      CONFIG.MODEL,
      {
        initProgressCallback: (progress) => {
          console.log("WebLLM:", progress);
        }
      }
    );

    aiReady = true;
    setAIStatus("Local AI", "#42d392");
    showToast("Local AI đã sẵn sàng.");
  } catch (error) {
    console.error("WebLLM error:", error);
    setAIStatus("AI lỗi", "#ff5f6d");
    throw error;
  } finally {
    loadingAI = false;
  }
}

/* ---------- CHAT ---------- */
function addMessage(type, text) {
  const message = window.document.createElement("div");
  message.className = `message ${type}`;

  const content = window.document.createElement("div");
  content.className = "message-content";
  content.textContent = text;

  message.appendChild(content);
  messages.appendChild(message);

  scrollChat();
}

function scrollChat() {
  const chat = $("#chat");
  chat.scrollTop = chat.scrollHeight;
}

function showTyping() {
  removeTyping();

  const message = window.document.createElement("div");
  message.id = "typing";
  message.className = "message ai";

  const content = window.document.createElement("div");
  content.className = "message-content";
  content.textContent = "🧠 Local AI đang suy nghĩ...";

  message.appendChild(content);
  messages.appendChild(message);
  scrollChat();
}

function removeTyping() {
  const typing = $("#typing");
  if (typing) typing.remove();
}

/* ---------- TEXT / CHUNKING ---------- */
function normalizeText(text) {
  return String(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createChunks(text) {
  text = normalizeText(text);

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(
      start + CONFIG.CHUNK_SIZE,
      text.length
    );

    if (end < text.length) {
      const newline = text.lastIndexOf("\n\n", end);
      const sentence = text.lastIndexOf(". ", end);
      const space = text.lastIndexOf(" ", end);

      if (newline > start + 300) {
        end = newline;
      } else if (sentence > start + 300) {
        end = sentence + 1;
      } else if (space > start) {
        end = space;
      }
    }

    const chunk = text.slice(start, end).trim();

    if (chunk) chunks.push(chunk);

    start = Math.max(
      end - CONFIG.CHUNK_OVERLAP,
      start + 1
    );
  }

  return chunks;
}

/* ---------- SIMPLE RETRIEVAL ---------- */
function keywords(text) {
  const stopWords = new Set([
    "và","là","của","cho","một","các","những","trong",
    "với","được","này","đó","khi","từ","đến",
    "the","and","this","that","what","how","is","are"
  ]);

  return normalizeText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= 2 &&
        !stopWords.has(word)
    );
}

function score(query, chunk) {
  const q = keywords(query);
  const c = keywords(chunk);

  if (!q.length || !c.length) return 0;

  const set = new Set(c);
  let matched = 0;

  for (const word of q) {
    if (set.has(word)) matched++;
  }

  return matched / Math.sqrt(c.length);
}

function retrieve(query) {
  if (!selectedDocument) return [];

  return selectedDocument.chunks
    .map((chunk, index) => ({
      chunk,
      index,
      score: score(query, chunk)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.TOP_K);
}

function createContext(query) {
  if (!selectedDocument) {
    return "Không có tài liệu được chọn.";
  }

  const results = retrieve(query);

  if (!results.length) {
    return `
TÀI LIỆU:
${selectedDocument.name}

Không tìm thấy đoạn liên quan rõ ràng.
`;
  }

  let context = `
TÀI LIỆU:
${selectedDocument.name}

NỘI DUNG LIÊN QUAN:
`;

  results.forEach((item, index) => {
    context += `

[Đoạn ${index + 1}]
${item.chunk}
`;
  });

  return context.substring(0, CONFIG.MAX_CONTEXT);
}

/* ---------- AI PROMPT ---------- */
function systemPrompt(query) {
  return `
Bạn là Local Study AI, một trợ lý học tập.

Quy tắc:
- Trả lời bằng tiếng Việt.
- Giải thích dễ hiểu.
- Khi giải toán hoặc vật lý, trình bày từng bước.
- Nếu có tài liệu, ưu tiên nội dung tài liệu.
- Không bịa nội dung tài liệu.
- Nếu tài liệu không đủ thông tin, nói rõ.
- Không khẳng định đã đọc nội dung không có trong context.

${createContext(query)}
`;
}

function getHistory() {
  return Array.from(messages.children)
    .filter((item) => item.id !== "typing")
    .slice(-CONFIG.MAX_HISTORY)
    .map((item) => ({
      role: item.classList.contains("user")
        ? "user"
        : "assistant",
      content:
        item.querySelector(".message-content")?.textContent || ""
    }));
}

/* ---------- GENERATE ---------- */
async function generate(prompt) {
  await loadAI();

  const history = getHistory();

  const response = await engine.chat.completions.create({
    messages: [
      {
        role: "system",
        content: systemPrompt(prompt)
      },
      ...history,
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: CONFIG.TEMPERATURE,
    max_tokens: CONFIG.MAX_TOKENS
  });

  return (
    response?.choices?.[0]?.message?.content?.trim() ||
    "AI không trả về kết quả."
  );
}

/* ---------- SEND ---------- */
async function sendMessage(forcedPrompt = null) {
  const prompt =
    forcedPrompt !== null
      ? forcedPrompt.trim()
      : input.value.trim();

  if (!prompt) return;

  welcome.style.display = "none";

  addMessage("user", prompt);

  input.value = "";
  resizeInput();

  send.disabled = true;
  showTyping();

  try {
    const answer = await generate(prompt);
    removeTyping();
    addMessage("ai", answer);
  } catch (error) {
    console.error(error);
    removeTyping();

    addMessage(
      "ai",
      `⚠️ Không thể sử dụng Local AI.

${error?.message || error}

Nếu đây là lần đầu chạy, hãy kiểm tra Console và chờ model tải hoàn tất.`
    );
  } finally {
    send.disabled = false;
  }
}

/* ---------- INPUT ---------- */
send.addEventListener("click", () => sendMessage());

input.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey
  ) {
    event.preventDefault();
    sendMessage();
  }
});

input.addEventListener("input", resizeInput);

function resizeInput() {
  input.style.height = "auto";
  input.style.height =
    Math.min(input.scrollHeight, 130) + "px";
}

/* ---------- QUICK PROMPTS ---------- */
$$(".quick button").forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt);
  });
});

/* ---------- CLEAR CHAT ---------- */
$("#clearChat").addEventListener("click", () => {
  messages.innerHTML = "";
  welcome.style.display = "";
  showToast("Đã xóa cuộc trò chuyện.");
});

/* =========================================================
   PDF / TXT
   ========================================================= */

async function readTXT(file) {
  return normalizeText(await file.text());
}

async function readPDF(file) {
  const buffer = await file.arrayBuffer();

  /*
   * GlobalWorkerOptions.workerSrc đã được cấu hình
   * ở đầu file nên getDocument() có thể chạy.
   */
  const loadingTask = pdfjsLib.getDocument({
    data: buffer
  });

  const pdf = await loadingTask.promise;

  let result = "";

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map((item) => item.str || "")
      .join(" ");

    result += `\n\n[Trang ${pageNumber}]\n`;
    result += pageText;
  }

  return normalizeText(result);
}

/* ---------- FILE PROCESSING ---------- */
async function processFile(file) {
  if (file.size > CONFIG.MAX_FILE_SIZE) {
    showToast("File vượt quá giới hạn 20MB.");
    return null;
  }

  const ext = file.name
    .split(".")
    .pop()
    .toLowerCase();

  let text = "";

  try {
    if (ext === "txt") {
      text = await readTXT(file);
    } else if (ext === "pdf") {
      text = await readPDF(file);
    } else {
      showToast(`Không hỗ trợ file: ${file.name}`);
      return null;
    }
  } catch (error) {
    console.error("File processing error:", error);
    showToast(`Không đọc được ${file.name}`);
    return null;
  }

  if (!text) {
    showToast("File không có nội dung văn bản.");
    return null;
  }

  return {
    id:
      crypto.randomUUID?.() ||
      `${Date.now()}-${Math.random()}`,
    name: file.name,
    size: file.size,
    type: ext,
    chunks: createChunks(text),
    created: Date.now()
  };
}

/* ---------- ADD FILES ---------- */
async function addFiles(fileList) {
  const list = Array.from(fileList);

  for (const file of list) {
    showToast(`Đang xử lý ${file.name}...`);

    const doc = await processFile(file);

    if (!doc) continue;

    documents.push(doc);
  }

  saveDocuments();
  renderDocuments();
  updateStats();

  showToast("Đã thêm tài liệu.");
}

fileInput.addEventListener("change", async (event) => {
  await addFiles(event.target.files);
  fileInput.value = "";
});

/* ---------- DRAG & DROP ---------- */
["dragenter", "dragover"].forEach((type) => {
  dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach((type) => {
  dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag");
  });
});

dropZone.addEventListener("drop", async (event) => {
  await addFiles(event.dataTransfer.files);
});

/* ---------- SELECT DOCUMENT ---------- */
function selectDocument(doc) {
  selectedDocument = doc;

  renderDocuments();

  showToast(`Đang học: ${doc.name}`);

  navs.forEach((nav) => {
    nav.classList.toggle(
      "active",
      nav.dataset.page === "chat"
    );
  });

  Object.values(pages).forEach((page) =>
    page.classList.remove("active")
  );

  pages.chat.classList.add("active");

  pageTitle.textContent = "AI Chat";
  pageDescription.textContent =
    `Đang học: ${doc.name}`;

  addMessage(
    "ai",
    `📚 Đã chọn:

${doc.name}

Đã tạo ${doc.chunks.length} chunks.

Bạn có thể hỏi:
• Tóm tắt tài liệu
• Giải thích một khái niệm
• Tạo câu hỏi trắc nghiệm
• Tìm công thức
• Giải bài tập`
  );
}

/* ---------- RENDER DOCUMENTS ---------- */
function renderDocuments() {
  filesContainer.innerHTML = "";

  documents.forEach((doc, index) => {
    /*
     * FIX:
     * Dùng doc thay vì document để không che khuất
     * DOM document.
     */
    const item = window.document.createElement("div");

    item.className = "file";

    if (
      selectedDocument &&
      selectedDocument.id === doc.id
    ) {
      item.classList.add("selected");
    }

    item.innerHTML = `
      <div style="font-size:24px">
        ${doc.type === "pdf" ? "📕" : "📝"}
      </div>

      <div class="file-info">
        <span class="file-name"></span>
        <div class="file-meta">
          ${doc.chunks.length} chunks
          • ${formatSize(doc.size)}
          ${
            selectedDocument &&
            selectedDocument.id === doc.id
              ? " • 🟢 đang học"
              : ""
          }
        </div>
      </div>

      <button
        class="file-btn use"
        data-index="${index}">
        Học
      </button>

      <button
        class="file-btn delete"
        data-index="${index}">
        ×
      </button>
    `;

    item.querySelector(".file-name").textContent =
      doc.name;

    filesContainer.appendChild(item);
  });

  $$(".use").forEach((button) => {
    button.addEventListener("click", () => {
      selectDocument(
        documents[
          Number(button.dataset.index)
        ]
      );
    });
  });

  $$(".delete").forEach((button) => {
    button.addEventListener("click", () => {
      const index =
        Number(button.dataset.index);

      const deleted = documents[index];

      if (
        selectedDocument &&
        selectedDocument.id === deleted.id
      ) {
        selectedDocument = null;
      }

      documents.splice(index, 1);

      saveDocuments();
      renderDocuments();
      updateStats();

      showToast("Đã xóa tài liệu.");
    });
  });
}

/* ---------- STORAGE ---------- */
function loadDocuments() {
  try {
    const raw =
      localStorage.getItem(
        "localStudyDocuments"
      );

    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error(
      "Không thể đọc Library:",
      error
    );
    return [];
  }
}

function saveDocuments() {
  try {
    localStorage.setItem(
      "localStudyDocuments",
      JSON.stringify(documents)
    );
  } catch (error) {
    console.error(
      "Không thể lưu Library:",
      error
    );

    showToast(
      "Không đủ bộ nhớ trình duyệt để lưu tài liệu."
    );
  }
}

/* ---------- HELPERS ---------- */
function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return (
      bytes / 1024
    ).toFixed(1) + " KB";
  }

  return (
    bytes / 1024 / 1024
  ).toFixed(1) + " MB";
}

function updateStats() {
  const totalChunks =
    documents.reduce(
      (total, doc) =>
        total + doc.chunks.length,
      0
    );

  fileCount.textContent =
    documents.length;

  chunkCount.textContent =
    totalChunks;
}

/* ---------- STUDY TOOLS ---------- */
const toolPrompts = {
  summary:
    "Hãy tóm tắt tài liệu đang học thành các ý chính.",

  explain:
    "Hãy giải thích những kiến thức quan trọng trong tài liệu thật dễ hiểu.",

  quiz:
    "Hãy tạo 5 câu hỏi trắc nghiệm dựa trên tài liệu đang học. Ghi đáp án ở cuối.",

  flashcard:
    "Hãy tạo 10 flashcard hỏi-đáp từ kiến thức quan trọng trong tài liệu."
};

$$(".tool").forEach((tool) => {
  tool.addEventListener("click", () => {
    const prompt =
      toolPrompts[tool.dataset.tool];

    navs.forEach((nav) => {
      nav.classList.toggle(
        "active",
        nav.dataset.page === "chat"
      );
    });

    Object.values(pages).forEach((page) =>
      page.classList.remove("active")
    );

    pages.chat.classList.add("active");

    pageTitle.textContent = "AI Chat";
    pageDescription.textContent =
      "Study Tools";

    sendMessage(prompt);
  });
});

/* ---------- INITIALIZE ---------- */
renderDocuments();
updateStats();
setAIStatus("AI chưa tải");

console.log("==============================");
console.log("🧠 LOCAL STUDY AI");
console.log("Local RAG: ON");
console.log("PDF: ON");
console.log("TXT: ON");
console.log("PDF Worker: ON");
console.log("WebLLM: ON");
console.log("==============================");
