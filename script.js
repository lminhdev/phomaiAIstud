/* ==========================================================
   LOCAL STUDY AI V2
   - WebLLM / WebGPU local inference
   - PDF.js 4.x with worker
   - Clean PDF text
   - Hybrid lexical retrieval + TF-IDF-like weighting
   - RAG context isolation
   - Study-specific prompts
   ========================================================== */

"use strict";

import { CreateMLCEngine } from
  "https://esm.run/@mlc-ai/web-llm";

const pdfjsLib = await import(
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs"
);

/* FIX: PDF.js worker */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

/* ---------------- CONFIG ---------------- */
const DEBUG = false;

const CONFIG = {
  MAX_FILE_SIZE: 20 * 1024 * 1024,
  CHUNK_SIZE: 900,
  CHUNK_OVERLAP: 120,
  TOP_K: 5,
  MAX_CONTEXT: 7000,
  MAX_HISTORY: 6,
  MAX_TOKENS: 700,
  TEMPERATURE: 0.25,
  DEFAULT_MODEL: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  MODELS: {
    "Llama-3.2-1B-Instruct-q4f16_1-MLC": {
      label: "Llama 3.2 1B",
      vram: "~879 MB",
      note: "Nhẹ hơn, phù hợp thiết bị hạn chế tài nguyên."
    },
    "Llama-3.2-3B-Instruct-q4f16_1-MLC": {
      label: "Llama 3.2 3B",
      vram: "~2.26 GB",
      note: "Chất lượng suy luận tốt hơn nhưng tải/nặng hơn."
    }
  }
};

/* ---------------- STATE ---------------- */
let engine = null;
let aiReady = false;
let aiLoading = false;
let modelId =
  localStorage.getItem("localStudyModel") ||
  CONFIG.DEFAULT_MODEL;

let selectedDocument = null;
let documents = loadDocuments();

/* ---------------- DOM ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const pages = {
  chat: $("#chatPage"),
  library: $("#libraryPage"),
  tools: $("#toolsPage")
};

const pageInfo = {
  chat: ["AI Chat", "Trợ lý học tập chạy trực tiếp trên trình duyệt."],
  library: ["Library", "Tài liệu học tập được xử lý trong trình duyệt."],
  tools: ["Study Tools", "Các tác vụ học tập được tối ưu bằng prompt."]
};

const messages = $("#messages");
const welcome = $("#welcome");
const input = $("#input");
const send = $("#send");
const status = $("#aiStatus");
const filesContainer = $("#files");
const activeDoc = $("#activeDoc");
const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const toast = $("#toast");

/* ---------------- BASIC UI ---------------- */
let toastTimer;

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => toast.classList.remove("show"),
    2600
  );
}

function setStatus(text, color = "#f3b32e") {
  status.innerHTML = `
    <i style="background:${color};box-shadow:0 0 9px ${color}"></i>
    <span>${escapeHTML(text)}</span>
  `;
}

function escapeHTML(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function switchPage(name) {
  $$(".nav").forEach((n) =>
    n.classList.toggle("active", n.dataset.page === name)
  );
  Object.values(pages).forEach((p) => p.classList.remove("active"));
  pages[name].classList.add("active");
  $("#pageTitle").textContent = pageInfo[name][0];
  $("#pageDescription").textContent = pageInfo[name][1];
}

$$(".nav").forEach((nav) => {
  nav.addEventListener("click", () => switchPage(nav.dataset.page));
});

/* ---------------- MODEL ---------------- */
function updateModelInfo() {
  const info = CONFIG.MODELS[$("#modelSelect")?.value] || CONFIG.MODELS[CONFIG.DEFAULT_MODEL];
  $("#modelInfo").textContent =
    `${info.label} • VRAM khoảng ${info.vram}. ${info.note}`;
}

function openModelModal() {
  if ($("#modelSelect")) $("#modelSelect").value = modelId;
  updateModelInfo();
  $("#modelModal").classList.remove("hidden");
}

$("#modelBtn")?.addEventListener("click", openModelModal);
$("#closeModal")?.addEventListener("click", () =>
  $("#modelModal").classList.add("hidden")
);
$("#modelSelect")?.addEventListener("change", updateModelInfo);

$("#applyModel")?.addEventListener("click", async () => {
  const next = $("#modelSelect").value;

  if (next === modelId && aiReady) {
    $("#modelModal").classList.add("hidden");
    return;
  }

  modelId = next;
  localStorage.setItem("localStudyModel", modelId);

  /* Engine cannot safely switch models in-place. */
  engine = null;
  aiReady = false;
  setStatus("AI chưa tải");
  $("#modelModal").classList.add("hidden");

  showToast("Đã đổi model. Hãy tải Local AI lại.");
});

/* ---------------- LOAD AI ---------------- */
async function loadAI() {
  if (aiReady && engine) return engine;
  if (aiLoading) {
    while (aiLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return engine;
  }

  if (!("gpu" in navigator)) {
    throw new Error(
      "Trình duyệt không hỗ trợ WebGPU. Hãy dùng Chrome/Edge phiên bản mới."
    );
  }

  aiLoading = true;
  setStatus("Đang tải model...");

  try {
    console.log("Loading model:", modelId);

    engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (progress) => {
        if (DEBUG) console.log("WebLLM:", progress);
        const text =
          typeof progress?.text === "string"
            ? progress.text
            : "Đang tải model...";
        setStatus(text.slice(0, 28));
      }
    });

    aiReady = true;
    setStatus(
      CONFIG.MODELS[modelId]?.label || "Local AI",
      "#42d392"
    );
    showToast("Local AI đã sẵn sàng.");
    return engine;
  } catch (error) {
    console.error("WebLLM:", error);
    setStatus("AI lỗi", "#ff5f6d");
    throw error;
  } finally {
    aiLoading = false;
  }
}

$("#loadAiSide")?.addEventListener("click", async () => {
  try {
    await loadAI();
  } catch (e) {
    showToast(e.message || "Không tải được AI.");
  }
});

/* ---------------- CHAT UI ---------------- */
function addMessage(role, text, sourceNames = []) {
  welcome.style.display = "none";

  const row = document.createElement("div");
  row.className = `message ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  if (sourceNames.length) {
    const source = document.createElement("span");
    source.className = "source";
    source.textContent =
      "Nguồn: " + [...new Set(sourceNames)].join(", ");
    bubble.appendChild(source);
  }

  row.appendChild(bubble);
  messages.appendChild(row);
  scrollChat();
}

function addTyping() {
  removeTyping();
  const row = document.createElement("div");
  row.id = "typing";
  row.className = "message ai";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = "🧠 Đang suy nghĩ...";

  row.appendChild(bubble);
  messages.appendChild(row);
  scrollChat();
}

function removeTyping() {
  $("#typing")?.remove();
}

function scrollChat() {
  const box = $("#chatScroll");
  box.scrollTop = box.scrollHeight;
}

$("#clearChat").addEventListener("click", () => {
  messages.innerHTML = "";
  welcome.style.display = "";
  showToast("Đã xóa cuộc trò chuyện.");
});

/* ---------------- TEXT CLEANING ---------------- */
function normalizeSpaces(s) {
  return String(s)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeForCompare(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * PDF text often repeats headers/footers/page labels.
 * Remove consecutive duplicates and obvious page-only lines.
 */
function cleanExtractedText(text) {
  const rawLines = normalizeSpaces(text)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const result = [];
  let previousKey = "";

  for (const line of rawLines) {
    const key = normalizeForCompare(line);

    if (!key) continue;

    /* page labels */
    if (/^(trang|page)\s*\d+$/i.test(line)) {
      continue;
    }

    /* same line repeated consecutively */
    if (key === previousKey) continue;

    result.push(line);
    previousKey = key;
  }

  /* Remove repeated lines that appear many times in the document. */
  const counts = new Map();

  for (const line of result) {
    const key = normalizeForCompare(line);
    if (key.length >= 8 && key.length <= 120) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const repeated = new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 4)
      .map(([key]) => key)
  );

  const filtered = result.filter((line) => {
    const key = normalizeForCompare(line);
    return !repeated.has(key);
  });

  return filtered.join("\n");
}

/* ---------------- CHUNKING ---------------- */
function splitIntoChunks(text) {
  const clean = cleanExtractedText(text);

  const paragraphs = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (
      current &&
      current.length + paragraph.length + 2 > CONFIG.CHUNK_SIZE
    ) {
      chunks.push(current.trim());

      const tail = current.slice(
        Math.max(0, current.length - CONFIG.CHUNK_OVERLAP)
      );

      current = tail + "\n" + paragraph;
    } else {
      current += (current ? "\n\n" : "") + paragraph;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  /* Safety fallback for giant single paragraphs. */
  const finalChunks = [];

  for (const chunk of chunks) {
    if (chunk.length <= CONFIG.CHUNK_SIZE * 1.25) {
      finalChunks.push(chunk);
      continue;
    }

    for (
      let start = 0;
      start < chunk.length;
      start += CONFIG.CHUNK_SIZE - CONFIG.CHUNK_OVERLAP
    ) {
      finalChunks.push(
        chunk.slice(start, start + CONFIG.CHUNK_SIZE).trim()
      );
    }
  }

  return finalChunks.filter((x) => x.length >= 30);
}

/* ---------------- RETRIEVAL ---------------- */
const STOP = new Set([
  "là","và","của","cho","một","các","những","trong","với","được",
  "này","đó","khi","từ","đến","về","như","theo","trên","dưới",
  "hãy","giúp","tôi","cho","biết","nào","gì","thế","này",
  "the","and","this","that","what","how","is","are","was","were",
  "with","from","into","your","you","please"
]);

function tokenize(text) {
  return normalizeForCompare(text)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function buildDocumentStats(chunks) {
  // Plain object is used instead of Map because documents are persisted
  // with JSON/localStorage. Map serializes to {} and later breaks retrieval.
  const df = Object.create(null);

  chunks.forEach((chunk) => {
    const unique = new Set(tokenize(chunk));
    unique.forEach((token) => {
      df[token] = (df[token] || 0) + 1;
    });
  });

  return { df, total: chunks.length };
}

function ensureDocumentStats(doc) {
  if (!doc || !Array.isArray(doc.chunks)) {
    return { df: Object.create(null), total: 0 };
  }

  const current = doc.stats;
  const validDF =
    current?.df &&
    typeof current.df === "object" &&
    !Array.isArray(current.df) &&
    Object.keys(current.df).length > 0;

  const validTotal =
    Number(current?.total) === doc.chunks.length;

  if (validDF && validTotal) {
    return current;
  }

  // Migration for old V2 documents: their Map was serialized by JSON as {}.
  const rebuilt = buildDocumentStats(doc.chunks);
  doc.stats = rebuilt;
  return rebuilt;
}

function retrievalScore(query, chunk, stats) {
  const qTokens = tokenize(query);
  const cTokens = tokenize(chunk);

  if (!qTokens.length || !cTokens.length) return 0;

  const tf = new Map();

  cTokens.forEach((t) =>
    tf.set(t, (tf.get(t) || 0) + 1)
  );

  const qUnique = [...new Set(qTokens)];
  let score = 0;

  for (const token of qUnique) {
    const freq = tf.get(token) || 0;
    if (!freq) continue;

    const df =
      stats?.df instanceof Map
        ? Number(stats.df.get(token) || 0)
        : Number(stats?.df?.[token] || 0);
    const idf =
      Math.log(
        (stats.total + 1) / (df + 1)
      ) + 1;

    score += (1 + Math.log(freq)) * idf;
  }

  /* Phrase bonus */
  const normalizedQ = normalizeForCompare(query);
  const normalizedC = normalizeForCompare(chunk);

  if (
    normalizedQ.length > 5 &&
    normalizedC.includes(normalizedQ)
  ) {
    score += 8;
  }

  /* Exact multi-word phrase bonus */
  const qWords = qUnique.slice(0, 5).join(" ");
  if (qWords.length > 5 && normalizedC.includes(qWords)) {
    score += 3;
  }

  return score;
}

function retrieve(query) {
  if (!selectedDocument) return [];

  const stats = ensureDocumentStats(selectedDocument);

  const ranked = selectedDocument.chunks
    .map((chunk, index) => ({
      chunk,
      index,
      score: retrievalScore(query, chunk, stats)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, CONFIG.TOP_K);
}

function makeContext(query) {
  if (!selectedDocument) {
    return {
      text: "",
      sources: []
    };
  }

  const results = retrieve(query);

  if (!results.length) {
    return {
      text:
        `TÀI LIỆU ĐANG HỌC: ${selectedDocument.name}\n` +
        "Không tìm thấy đoạn văn bản đủ liên quan cho câu hỏi này.",
      sources: [selectedDocument.name]
    };
  }

  let context = `
TÀI LIỆU ĐANG HỌC:
${selectedDocument.name}

CÁC ĐOẠN LIÊN QUAN:
`;

  results.forEach((item, i) => {
    context +=
      `\n[Đoạn ${i + 1} | chunk ${item.index + 1}]\n` +
      item.chunk +
      "\n";
  });

  return {
    text: context.slice(0, CONFIG.MAX_CONTEXT),
    sources: [selectedDocument.name]
  };
}

/* ---------------- STUDY PROMPTS ---------------- */
const TASKS = {
  normal: `
Trả lời câu hỏi của học sinh.
Nếu câu hỏi liên quan tài liệu, ưu tiên tài liệu.
Nếu không có đủ dữ liệu trong tài liệu, nói rõ điều đó.
Không được lặp lại nguyên văn tài liệu một cách vô ích.
`,

  summary: `
Hãy tóm tắt tài liệu.
Cấu trúc bắt buộc:
1. Chủ đề chính
2. Các ý quan trọng
3. Công thức/khái niệm cần nhớ (nếu có)
4. Điều cần nhớ trước khi kiểm tra
Không sao chép nguyên văn dài dòng.
`,

  explain: `
Hãy giải thích kiến thức.
Cấu trúc:
1. Nói ngắn gọn kiến thức là gì.
2. Giải thích từng bước bằng ngôn ngữ dễ hiểu.
3. Cho ví dụ nếu tài liệu có ví dụ hoặc dữ liệu phù hợp.
4. Chốt lại điều cần nhớ.
`,

  quiz: `
Hãy tạo đúng 5 câu hỏi trắc nghiệm dựa trên tài liệu.
Mỗi câu có A, B, C, D.
Chỉ có một đáp án đúng.
Sau cùng tạo mục "ĐÁP ÁN" với 1-5.
Không đưa đáp án ngay sau từng câu.
`,

  flashcard: `
Hãy tạo 10 flashcard quan trọng nhất.
Mỗi thẻ:
THẺ 1
Q: ...
A: ...
Không thêm nội dung không được hỗ trợ bởi tài liệu.
`,

  outline: `
Hãy tạo dàn ý học tập từ tài liệu:
I. ...
  1. ...
  2. ...
II. ...
Chỉ giữ các phần thực sự có trong tài liệu.
`,

  exam: `
Hãy tạo một đề ôn tập tổng hợp dựa trên tài liệu:
- 5 câu trắc nghiệm
- 2 câu trả lời ngắn
- 1 câu vận dụng
Cuối cùng có đáp án/gợi ý.
`
};

function detectTask(prompt) {
  const p = normalizeForCompare(prompt);

  if (/tom tat|tóm tắt|summary/.test(p)) return "summary";
  if (/trac nghiem|trắc nghiệm|quiz/.test(p)) return "quiz";
  if (/flashcard/.test(p)) return "flashcard";
  if (/dan y|dàn ý|outline/.test(p)) return "outline";
  if (/de on tap|đề ôn tập|exam/.test(p)) return "exam";
  if (/giai thich|giải thích|explain/.test(p)) return "explain";

  return "normal";
}

function buildSystemPrompt(prompt) {
  const task = detectTask(prompt);
  const context = makeContext(prompt);

  return `
Bạn là Local Study AI V2, một trợ lý học tập.

MỤC TIÊU:
- Giúp học sinh hiểu bài, không chỉ nhắc lại văn bản.
- Trả lời bằng tiếng Việt tự nhiên.
- Ưu tiên dữ liệu trong tài liệu được cung cấp.
- Nếu tài liệu không có câu trả lời, phải nói "Tài liệu không cung cấp đủ thông tin cho câu này" thay vì bịa.
- Không được giả vờ đã nhìn thấy hình ảnh/công thức nếu PDF chỉ chứa text không có dữ liệu đó.
- Không lặp một câu/đoạn nhiều lần.
- Không tự chèn "Trang 1" lặp lại.
- Không chép cả tài liệu để trả lời.
- Khi giải bài: nêu dữ kiện → công thức/phương pháp → tính toán/suy luận → kết luận.
- Khi tạo quiz: câu hỏi phải dựa trên nội dung tài liệu.
- Nếu người dùng hỏi kiến thức chung và không có tài liệu liên quan, có thể trả lời bằng kiến thức của model nhưng nên nói rõ khi cần.

NHIỆM VỤ:
${TASKS[task]}

${context.text}
`;
}

/* ---------------- HISTORY ---------------- */
function getConversationHistory() {
  const items = [...messages.children]
    .filter((el) => el.id !== "typing");

  // sendMessage() adds the current user prompt before generation.
  // Do not send that same prompt twice (history + current user message).
  if (items.length && items[items.length - 1].classList.contains("user")) {
    items.pop();
  }

  return items.slice(-CONFIG.MAX_HISTORY)
    .map((el) => ({
      role: el.classList.contains("user")
        ? "user"
        : "assistant",
      content:
        el.querySelector(".bubble")?.childNodes[0]?.textContent?.trim() ||
        ""
    }))
    .filter((x) => x.content);
}

/* ---------------- GENERATION ---------------- */
async function generateAnswer(prompt) {
  const llm = await loadAI();
  const context = makeContext(prompt);

  const history = getConversationHistory();

  const result =
    await llm.chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(prompt)
        },
        ...history,
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: CONFIG.TEMPERATURE,
      max_tokens: CONFIG.MAX_TOKENS,
      stream: false
    });

  const answer =
    result?.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error("Model không trả về nội dung.");
  }

  return {
    answer,
    sources: context.sources
  };
}

/* ---------------- SEND ---------------- */
async function sendMessage(promptOverride = null) {
  const prompt =
    promptOverride !== null
      ? promptOverride.trim()
      : input.value.trim();

  if (!prompt || send.disabled) return;

  addMessage("user", prompt);
  input.value = "";
  resizeInput();

  send.disabled = true;
  addTyping();

  try {
    const result = await generateAnswer(prompt);
    removeTyping();
    addMessage("ai", result.answer, result.sources);
  } catch (error) {
    console.error(error);
    removeTyping();

    addMessage(
      "ai",
      `⚠️ Không thể trả lời bằng Local AI.

${error.message || error}

Kiểm tra WebGPU và Console để xem lỗi chi tiết.`
    );
  } finally {
    send.disabled = false;
  }
}

$("#send").addEventListener("click", () => sendMessage());

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

input.addEventListener("input", resizeInput);

function resizeInput() {
  input.style.height = "auto";
  input.style.height =
    Math.min(input.scrollHeight, 140) + "px";
}

$$(".quick-grid button").forEach((button) => {
  button.addEventListener("click", () =>
    sendMessage(button.dataset.prompt)
  );
});

/* ---------------- DOCUMENT ---------------- */
async function readTXT(file) {
  return cleanExtractedText(await file.text());
}

async function readPDF(file) {
  const buffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: buffer
  });

  const pdf = await loadingTask.promise;
  const pagesText = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const text = content.items
      .map((item) => item.str || "")
      .join(" ");

    pagesText.push(text);
  }

  return cleanExtractedText(
    pagesText.join("\n\n")
  );
}

async function processFile(file) {
  if (file.size > CONFIG.MAX_FILE_SIZE) {
    throw new Error(`${file.name}: vượt quá 20 MB.`);
  }

  const ext =
    file.name.split(".").pop().toLowerCase();

  let text;

  if (ext === "pdf") {
    text = await readPDF(file);
  } else if (ext === "txt") {
    text = await readTXT(file);
  } else {
    throw new Error("Chỉ hỗ trợ PDF và TXT.");
  }

  if (!text || text.length < 20) {
    throw new Error(
      "Không tìm thấy đủ text. PDF scan/ảnh có thể cần OCR."
    );
  }

  const chunks = splitIntoChunks(text);

  const stats = buildDocumentStats(chunks);

  return {
    id:
      crypto.randomUUID?.() ||
      `${Date.now()}-${Math.random()}`,
    name: file.name,
    size: file.size,
    type: ext,
    text,
    chunks,
    stats,
    wordCount: tokenize(text).length,
    created: Date.now()
  };
}

async function addFiles(fileList) {
  for (const file of Array.from(fileList)) {
    try {
      showToast(`Đang xử lý ${file.name}...`);

      const doc = await processFile(file);

      documents = documents.filter(
        (d) => d.name !== doc.name
      );

      documents.push(doc);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Không đọc được file.");
    }
  }

  saveDocuments();
  renderDocuments();
  updateStats();

  showToast("Đã xử lý tài liệu.");
}

fileInput.addEventListener("change", async (e) => {
  await addFiles(e.target.files);
  fileInput.value = "";
});

/* ---------------- DROP ---------------- */
["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag");
  });
});

dropZone.addEventListener("drop", async (e) => {
  await addFiles(e.dataTransfer.files);
});

/* ---------------- LIBRARY ---------------- */
function selectDocument(doc) {
  ensureDocumentStats(doc);
  selectedDocument = doc;

  renderDocuments();
  updateActiveDoc();

  switchPage("chat");

  addMessage(
    "ai",
    `📚 Đã chọn tài liệu "${doc.name}".

Tôi sẽ ưu tiên nội dung tài liệu này khi trả lời.
Bạn có thể hỏi: "tóm tắt", "giải thích phần này", "tạo quiz", hoặc đặt câu hỏi cụ thể.`
  );
}

function updateActiveDoc() {
  if (!selectedDocument) {
    activeDoc.classList.add("hidden");
    activeDoc.textContent = "";
    return;
  }

  activeDoc.classList.remove("hidden");
  activeDoc.innerHTML =
    `📚 Đang học: <b>${escapeHTML(selectedDocument.name)}</b>`;
}

function renderDocuments() {
  filesContainer.innerHTML = "";

  documents.forEach((doc, index) => {
    const item = document.createElement("div");
    item.className =
      "file" +
      (
        selectedDocument?.id === doc.id
          ? " selected"
          : ""
      );

    item.innerHTML = `
      <div class="file-icon">${doc.type === "pdf" ? "📕" : "📝"}</div>
      <div class="file-info">
        <div class="file-name"></div>
        <div class="file-meta">
          ${doc.chunks.length} chunks • ${formatSize(doc.size)} • ${doc.wordCount || 0} từ
          ${selectedDocument?.id === doc.id ? " • 🟢 đang học" : ""}
        </div>
      </div>
      <button class="file-btn use" data-index="${index}">Học</button>
      <button class="file-btn delete" data-index="${index}">×</button>
    `;

    item.querySelector(".file-name").textContent =
      doc.name;

    filesContainer.appendChild(item);
  });

  $$(".file-btn.use").forEach((button) => {
    button.addEventListener("click", () => {
      selectDocument(
        documents[
          Number(button.dataset.index)
        ]
      );
    });
  });

  $$(".file-btn.delete").forEach((button) => {
    button.addEventListener("click", () => {
      const index =
        Number(button.dataset.index);

      const deleted = documents[index];

      if (selectedDocument?.id === deleted.id) {
        selectedDocument = null;
        updateActiveDoc();
      }

      documents.splice(index, 1);
      saveDocuments();
      renderDocuments();
      updateStats();

      showToast("Đã xóa tài liệu.");
    });
  });
}

/* ---------------- STORAGE ---------------- */
function loadDocuments() {
  try {
    const raw =
      localStorage.getItem(
        "localStudyDocumentsV2"
      );

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    // Repair documents saved by the broken V2 build where stats.df was a Map
    // and therefore became an empty object after JSON.stringify().
    let changed = false;

    const repaired = parsed
      .filter((doc) => doc && Array.isArray(doc.chunks))
      .map((doc) => {
        const before = doc.stats;
        const stats = ensureDocumentStats(doc);
        if (stats !== before) changed = true;
        return doc;
      });

    if (changed) {
      try {
        localStorage.setItem(
          "localStudyDocumentsV2",
          JSON.stringify(repaired)
        );
      } catch (e) {
        console.warn("Không thể lưu dữ liệu RAG đã sửa:", e);
      }
    }

    return repaired;
  } catch (e) {
    console.warn("Library reset:", e);
    return [];
  }
}

function saveDocuments() {
  try {
    localStorage.setItem(
      "localStudyDocumentsV2",
      JSON.stringify(documents)
    );
  } catch (e) {
    console.error(e);

    /*
     * Text/chunks can exceed localStorage.
     * Keep the current session even if persistence fails.
     */
    showToast(
      "Tài liệu quá lớn để lưu lâu dài trong LocalStorage; vẫn dùng được trong phiên này."
    );
  }
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function updateStats() {
  const chunks =
    documents.reduce(
      (n, d) => n + (d.chunks?.length || 0),
      0
    );

  const words =
    documents.reduce(
      (n, d) => n + (d.wordCount || 0),
      0
    );

  $("#fileCount").textContent =
    documents.length;

  $("#chunkCount").textContent =
    chunks;

  $("#wordCount").textContent =
    words.toLocaleString("vi-VN");
}

/* ---------------- TOOLS ---------------- */
const toolPrompts = {
  summary: TASKS.summary,
  explain: TASKS.explain,
  quiz: TASKS.quiz,
  flashcard: TASKS.flashcard,
  outline: TASKS.outline,
  exam: TASKS.exam
};

$$(".tool").forEach((tool) => {
  tool.addEventListener("click", () => {
    switchPage("chat");
    sendMessage(toolPrompts[tool.dataset.tool]);
  });
});

/* ---------------- INIT ---------------- */
renderDocuments();
updateStats();
updateActiveDoc();
setStatus("AI chưa tải");

console.log("================================");
console.log("🧠 LOCAL STUDY AI V2");
console.log("WebLLM: ON");
console.log("WebGPU: " + ("gpu" in navigator ? "ON" : "OFF"));
console.log("PDF.js: ON");
console.log("PDF Worker: ON");
console.log("Hybrid RAG: ON");
console.log("Model:", modelId);
console.log("================================");
