// Content Script - 运行在每个网页上

let summaryBox = null;
let isLoading = false;

// ─── 设置读取 ───────────────────────────────────────────────
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        "enabled",
        "baseUrl",
        "model",
        "apiKey",
        "blockedSites",
        "customPrompt",
        "smartTrigger",
        "autoWhitelist",
      ],
      resolve,
    );
  });
}

// ─── 域名检查 ───────────────────────────────────────────────
function isSiteBlocked(blockedSites = []) {
  if (!blockedSites || blockedSites.length === 0) return false;
  const current = window.location.hostname.replace(/^www\./, "").toLowerCase();
  return blockedSites.some((site) => {
    const s = site
      .replace(/^www\./, "")
      .toLowerCase()
      .trim();
    return s === current || current.endsWith(`.${s}`);
  });
}

// ─── 简化版 Readability 评分引擎 ──────────────────────────────
const TAG_SCORES = {
  ARTICLE: 25,
  SECTION: 15,
  MAIN: 20,
  PRE: 3,
  BLOCKQUOTE: 3,
  DIV: 5,
  TD: 3,
  ADDRESS: 3,
  FORM: -3,
  NAV: -25,
  ASIDE: -15,
  FOOTER: -20,
  HEADER: -15,
  A: -5,
};

const POSITIVE_PATTERNS = [
  "article", "post", "entry", "text", "content", "story", "blog",
  "essay", "documentation", "tutorial", "guide", "read", "main", "body",
];

const NEGATIVE_PATTERNS = [
  "comment", "social", "share", "sidebar", "footer", "menu", "nav",
  "masthead", "ad", "advert", "banner", "popup", "modal", "overlay",
  "related", "recommended", "widget", "toolbar", "header", "copyright",
  "badge", "avatar", "meta", "info", "stat", "counter", "subscribe",
  "newsletter", "breadcrumb", "pagination", "tag", "category",
];

const MIN_TEXT_LEN = 25;
let _cachedAnalysis = null;

function getTextLen(el) {
  return (el.textContent || "").trim().length;
}

function getLinkTextLen(el) {
  let len = 0;
  const links = el.querySelectorAll("a");
  for (const a of links) {
    len += (a.textContent || "").trim().length;
  }
  return len;
}

function getLinkDensity(el) {
  const total = getTextLen(el);
  if (total === 0) return 1;
  return getLinkTextLen(el) / total;
}

function getClassWeight(el) {
  const str = ((el.className || "") + " " + (el.id || "")).toLowerCase();
  let weight = 0;
  for (const p of POSITIVE_PATTERNS) {
    if (str.includes(p)) weight += 25;
  }
  for (const p of NEGATIVE_PATTERNS) {
    if (str.includes(p)) weight -= 25;
  }
  return weight;
}

function initNode(node) {
  node._articleScore = 0;
  const tag = node.tagName;
  if (TAG_SCORES[tag] !== undefined) {
    node._articleScore += TAG_SCORES[tag];
  }
  node._articleScore += getClassWeight(node);
}

function scorePage() {
  const paragraphs = document.querySelectorAll("p, pre, blockquote, td, li");
  let topScore = 0;
  let bestElement = null;
  const scored = new Set();

  for (const p of paragraphs) {
    const text = getTextLen(p);
    if (text < MIN_TEXT_LEN) continue;
    if (getLinkDensity(p) > 0.5) continue;

    let score = 1;
    score += Math.min(Math.floor(text / 100), 3);
    score += ((p.textContent || "").match(/[,。；，]/g) || []).length;

    let ancestor = p.parentElement;
    let depth = 0;
    while (ancestor && depth < 8) {
      if (scored.has(ancestor)) {
        ancestor._articleScore += score / (depth + 1);
      } else {
        initNode(ancestor);
        ancestor._articleScore =
          (ancestor._articleScore || 0) + score / (depth + 1);
        scored.add(ancestor);
      }

      if (ancestor._articleScore > topScore) {
        topScore = ancestor._articleScore;
        bestElement = ancestor;
      }

      ancestor = ancestor.parentElement;
      depth++;
    }
  }

  return { topScore, bestElement };
}

function shouldAutoSummarize(blockedSites) {
  if (isSiteBlocked(blockedSites)) {
    return { should: false, reason: "domain_blocked" };
  }

  const hostname = window.location.hostname.replace(/^www\./, "").toLowerCase();

  const skipPatterns = [
    /youtube|youtu\.be|bilibili|vimeo|twitch|douyin|ixigua|dailymotion|netflix|hbo|tiktok/i,
    /google\.com|bing|baidu|yandex|sogou|duckduckgo|search\.|so\.com/i,
    /twitter|x\.com|facebook|instagram|reddit|weibo|threads|mastodon/i,
    /github\.com|gitlab|bitbucket|stackoverflow|stackblitz|codepen/i,
    /read\.the|notion\.so|confluence|feishu|slack|figma/i,
    /taobao|tmall|jd\.com|amazon|ebay|aliexpress|wiki|zhihu/i,
  ];
  if (skipPatterns.some((p) => p.test(hostname))) {
    return { should: false, reason: "domain_skip_list" };
  }

  const bodyDensity = getLinkDensity(document.body);
  if (bodyDensity > 0.6) {
    return { should: false, reason: "link_heavy_page" };
  }

  const bodyText = getTextLen(document.body);
  if (bodyText < 600) {
    return { should: false, reason: "page_too_short" };
  }

  const { topScore, bestElement } = scorePage();
  _cachedAnalysis = { topScore, bestElement };

  const allLis = document.querySelectorAll("li");
  if (allLis.length > 10) {
    let totalLiText = 0;
    let shortLis = 0;
    for (const li of allLis) {
      const len = getTextLen(li);
      totalLiText += len;
      if (len < 60) shortLis++;
    }
    const avgLiText = totalLiText / allLis.length;
    if (allLis.length > 15 && avgLiText < 80 && shortLis / allLis.length > 0.6) {
      return { should: false, reason: "list_page_detected", stats: { topScore, liCount: allLis.length, avgLiText } };
    }
  }

  if (topScore < 5) {
    return { should: false, reason: "low_article_score", stats: { topScore } };
  }

  if (bestElement) {
    const bestDensity = getLinkDensity(bestElement);
    if (bestDensity > 0.6) {
      return { should: false, reason: "best_candidate_too_navHeavy", stats: { topScore, bestDensity } };
    }
  }

  return { should: true, reason: "passed", stats: { topScore } };
}

function findBestContentElement() {
  if (_cachedAnalysis && _cachedAnalysis.bestElement) {
    return _cachedAnalysis.bestElement;
  }
  const { bestElement } = scorePage();
  return bestElement || document.body;
}

function getErrorMessage(err) {
  if (typeof err === "string") return err;
  if (err && err.message) return err.message;
  if (err && err.type === "error" && err.target) {
    const src = err.target.src || err.target.tagName;
    return `脚本加载失败: ${src}`;
  }
  if (err && err.status) return `HTTP ${err.status}`;
  return "未知错误";
}

// ─── Markdown 渲染器 ───────────────────────────────────────
function parseMarkdown(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");
  html = html.replace(/\*([\s\S]+?)\*/g, "<em>$1</em>");
  html = html.replace(/_([\s\S]+?)_/g, "<em>$1</em>");
  html = html.replace(/~~([\s\S]+?)~~/g, "<del>$1</del>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/^\s*>+\s?(.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "<br>");
  html = html.replace(/^---$/gm, "<hr>");
  html = html.replace(/^\*\*\*$/gm, "<hr>");
  html = html.replace(/^[ ]{2,3}([\-\*]) (.+)$/gm, "<ul style='margin-left:20px;'><li>$2</li></ul>");
  html = html.replace(/^[ ]{4,}([\-\*]) (.+)$/gm, "<ul style='margin-left:40px;'><li>$2</li></ul>");
  html = html.replace(/^[ ]{0,1}([\-\*]) (.+)$/gm, "<li>$2</li>");
  html = html.replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>");
  html = html.replace(/<\/li>\n<li>/g, "</li><li>");
  html = html.replace(/<\/ul>\n<ul/g, "</ul><ul");

  const lines = html.split(/\n/);
  const paragraphs = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<pre>") || trimmed.startsWith("<h") || trimmed.startsWith("<blockquote") ||
        trimmed.startsWith("<li") || trimmed.startsWith("<hr") || trimmed.startsWith("<ul>") ||
        trimmed.startsWith("<ol>") || trimmed.startsWith("<p")) {
      return trimmed;
    }
    return `<p>${trimmed}</p>`;
  });
  html = paragraphs.join("\n");

  return html;
}

function renderLatex(html) {
  return html
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => `<span style="font-family:serif;font-style:italic;opacity:0.7;">[公式: ${expr.slice(0, 30)}${expr.length > 30 ? "..." : ""}]</span>`)
    .replace(/\$([^$\n]+?)\$/g, (_, expr) => `<span style="font-family:serif;font-style:italic;opacity:0.7;">${expr}</span>`);
}

function renderContent(text) {
  text = stripThinking(text);
  let html = parseMarkdown(text);
  html = renderLatex(html);
  return html;
}

function stripThinking(text) {
  return text.replace(/<concite>[\s\S]*?<\/concite>/gi, "");
}

// ─── 流式渲染器 ─────────────────────────────────────────────
async function createStreamingBox() {
  if (summaryBox) {
    summaryBox.remove();
    summaryBox = null;
  }

  const h1 = document.querySelector("h1") || document.querySelector("h2") || document.querySelector("header") || document.querySelector("article") || document.body.firstElementChild;

  summaryBox = document.createElement("div");
  summaryBox.id = "web-summarizer-box";

  summaryBox.style.cssText = `
    display: block; visibility: visible; opacity: 1; position: relative;
    margin: 24px 0; padding: 0; border: none; width: 100%; min-width: 0;
    max-width: none; box-sizing: border-box;
    background-color: #000 !important; color: #e0e0e0 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px; line-height: normal; text-align: left; unicode-bidi: normal;
  `;

  summaryBox.innerHTML = `
    <div style="padding: 20px 24px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <span style="font-size:12px;color:#555;font-family:monospace;letter-spacing:1px;">[SUMMARY]</span>
        <span style="font-size:11px;color:#333;font-family:monospace;flex:1;" id="wsStreamStatus">等待响应...</span>
        <button id="wsCopyBtn" style="background:none;border:1px solid #2a2a2a;color:#555;cursor:pointer;font-size:10px;font-family:monospace;padding:2px 8px;border-radius:2px;flex-shrink:0;">COPY</button>
        <button id="wsCloseBtn" style="background:none;border:none;color:#444;cursor:pointer;font-size:14px;padding:0 2px;line-height:1;flex-shrink:0;">×</button>
      </div>
      <div id="wsContent" style="font-size:13px;line-height:1.8;color:#e0e0e0 !important;min-height:24px;max-height:400px;overflow-y:auto;">
        <span style="color:#555;font-family:monospace;animation:ws-blink 1s infinite;">▋</span>
      </div>
    </div>`;

  if (!document.getElementById("ws-stream-styles")) {
    const style = document.createElement("style");
    style.id = "ws-stream-styles";
    style.textContent = `
      @keyframes ws-blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
      #web-summarizer-box { display: block !important; }
      #web-summarizer-box * { box-sizing: border-box; color:inherit; background:inherit; }
      #web-summarizer-box pre { background:#111 !important;padding:12px;border-radius:4px;overflow-x:auto;margin:12px 0; }
      #web-summarizer-box code { font-family:'SF Mono',Consolas,monospace;font-size:12px;background:#1a1a1a !important;padding:2px 5px;border-radius:3px;color:#d0d0d0 !important; }
      #web-summarizer-box pre code { background:none !important;padding:0;color:#d0d0d0 !important; }
      #web-summarizer-box blockquote { border-left:3px solid #333;margin:12px 0;padding-left:16px;color:#a0a0a0 !important; }
      #web-summarizer-box a { color:#6eb5ff !important;text-decoration:none; }
      #web-summarizer-box a:hover { text-decoration:underline; }
      #web-summarizer-box ul,#web-summarizer-box ol { padding-left:20px;margin:8px 0; }
      #web-summarizer-box li { margin:4px 0;font-weight:400;color:#d8d8d8 !important; }
      #web-summarizer-box h1,#web-summarizer-box h2,#web-summarizer-box h3 { color:#e8e8e8 !important;margin:16px 0 8px;font-weight:600; }
      #web-summarizer-box h1 { font-size:16px; }
      #web-summarizer-box h2 { font-size:14px; }
      #web-summarizer-box h3 { font-size:13px; }
      #web-summarizer-box p { margin:8px 0;font-weight:400;color:#d8d8d8 !important; }
      #web-summarizer-box hr { border:none;border-top:1px solid #222;margin:16px 0; }
      #web-summarizer-box table { border-collapse:collapse;width:100%;margin:12px 0; }
      #web-summarizer-box th,#web-summarizer-box td { border:1px solid #222;padding:8px;text-align:left; }
      #web-summarizer-box th { background:#111 !important;color:#e0e0e0 !important; }
      #web-summarizer-box img { max-width:100%;height:auto; }`;
    document.head.appendChild(style);
  }

  summaryBox.querySelector("#wsCloseBtn").addEventListener("click", () => {
    summaryBox.remove();
    summaryBox = null;
  });

  let targetParent = h1 ? h1.parentNode : null;
  if (targetParent) {
    let depth = 0;
    while (targetParent && depth < 10) {
      const display = window.getComputedStyle(targetParent).display;
      if (display === "block" || display === "flow-root") break;
      const parent = targetParent.parentNode;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      targetParent = parent;
      depth++;
    }
    targetParent = targetParent || document.body;
    targetParent.appendChild(summaryBox);
  } else {
    document.body.insertBefore(summaryBox, document.body.firstChild);
  }

  return summaryBox;
}

async function updateStreamingContent(fullText) {
  if (!summaryBox) return;
  const contentEl = summaryBox.querySelector("#wsContent");
  const statusEl = summaryBox.querySelector("#wsStreamStatus");
  if (!contentEl) return;

  summaryBox.dataset.raw = fullText;
  const displayText = stripThinking(fullText);
  const rendered = await renderContent(displayText);
  contentEl.innerHTML = rendered;
  statusEl.textContent = "完成";
  statusEl.style.color = "#4ade80";

  const copyBtn = summaryBox.querySelector("#wsCopyBtn");
  if (copyBtn) {
    copyBtn.textContent = "COPY";
    copyBtn.style.color = "#555";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(fullText).then(() => {
        copyBtn.textContent = "COPIED";
        copyBtn.style.color = "#4ade80";
        setTimeout(() => {
          copyBtn.textContent = "COPY";
          copyBtn.style.color = "#555";
        }, 2000);
      });
    };
  }
}

async function appendStreamingContent(newText) {
  if (!summaryBox) return;
  const contentEl = summaryBox.querySelector("#wsContent");
  const statusEl = summaryBox.querySelector("#wsStreamStatus");
  if (!contentEl) return;

  const currentText = summaryBox.dataset.raw || "";
  const fullText = currentText + newText;
  summaryBox.dataset.raw = fullText;

  const hasThinking = /<concite>/i.test(newText);
  const displayText = stripThinking(fullText);

  if (hasThinking) {
    statusEl.textContent = "思考中...";
    statusEl.style.color = "#f59e0b";
  } else {
    statusEl.textContent = "生成中...";
    statusEl.style.color = "#60a5fa";
  }

  const rendered = await renderContent(displayText);
  contentEl.innerHTML = rendered + `<span style="color:#555;font-family:monospace;animation:ws-blink 1s infinite;">▋</span>`;
}

function showError(msg) {
  isLoading = false;
  if (summaryBox) {
    summaryBox.remove();
    summaryBox = null;
  }

  const h1 = document.querySelector("h1") || document.querySelector("h2") || document.querySelector("header") || document.querySelector("article") || document.body.firstElementChild;

  summaryBox = document.createElement("div");
  summaryBox.id = "web-summarizer-box";
  summaryBox.style.cssText = `
    display: block; visibility: visible; opacity: 1; position: relative;
    margin: 24px 0; padding: 0; border: none; width: 100%; min-width: 0;
    max-width: none; box-sizing: border-box;
    background-color: #000 !important; color: #e0e0e0 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px; line-height: normal; text-align: left; unicode-bidi: normal;`;

  summaryBox.innerHTML = `
    <div style="padding:20px 24px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <span style="font-size:12px;color:#555;font-family:monospace;letter-spacing:1px;">[SUMMARY]</span>
        <span style="font-size:11px;color:#f87171;font-family:monospace;flex:1;">ERROR</span>
        <button id="wsCloseBtn2" style="background:none;border:none;color:#444;cursor:pointer;font-size:14px;padding:0 2px;line-height:1;flex-shrink:0;">×</button>
      </div>
      <div style="font-size:13px;color:#f87171;line-height:1.6;">${msg}</div>
    </div>`;

  summaryBox.querySelector("#wsCloseBtn").addEventListener("click", () => {
    summaryBox.remove();
    summaryBox = null;
  });

  let targetParent = h1 ? h1.parentNode : null;
  if (targetParent) {
    let depth = 0;
    while (targetParent && depth < 10) {
      const display = window.getComputedStyle(targetParent).display;
      if (display === "block" || display === "flow-root") break;
      const parent = targetParent.parentNode;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      targetParent = parent;
      depth++;
    }
    targetParent = targetParent || document.body;
    targetParent.appendChild(summaryBox);
  } else {
    document.body.insertBefore(summaryBox, document.body.firstChild);
  }
}

// ─── 核心流程 ───────────────────────────────────────────────
async function autoSummarizePage() {
  const settings = await getSettings();
  if (settings.enabled === false) return;
  const blockedSites = settings.blockedSites || [];
  const whitelist = settings.autoWhitelist || [];
  const currentHostname = window.location.hostname.replace(/^www\./, "").toLowerCase();

  if (whitelist.includes(currentHostname)) {
    return summarizePage();
  }
  if (isSiteBlocked(blockedSites)) return;

  const smartTrigger = settings.smartTrigger !== false;
  if (!smartTrigger) return;

  const result = shouldAutoSummarize(blockedSites);
  if (!result.should) return;

  return summarizePage();
}

async function summarizePage() {
  const settings = await getSettings();
  const blockedSites = settings.blockedSites || [];

  if (settings.enabled === false) return;
  if (isSiteBlocked(blockedSites)) return;

  const currentHostname = window.location.hostname.replace(/^www\./, "").toLowerCase();
  const autoResult = shouldAutoSummarize(blockedSites);
  if (!autoResult.should) {
    const whitelist = settings.autoWhitelist || [];
    if (!whitelist.includes(currentHostname)) {
      whitelist.push(currentHostname);
      await chrome.storage.local.set({ autoWhitelist: whitelist });
    }
  }

  return doSummarize(settings);
}

async function doSummarize(settings) {
  settings.baseUrl = settings.baseUrl || "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  settings.model = settings.model || "glm-4-flash";
  settings.customPrompt = settings.customPrompt ||
    `请阅读以下内容，并生成**正式、结构清晰、条目分明、可读性高的总结**，采用 Markdown 格式。

要求：
1. 开头使用一级标题提供主题
2. 分三部分：摘要、正文、一句话总结
3. 条目分明，用 emoji 标注类型
4. 保留关键数字和原文引用

待总结材料如下：`;

  const { title, content } = getPageContent();
  if (!content || content.length < 50) {
    showError("⚠️ 无法获取足够的内容进行总结");
    return;
  }

  await createStreamingBox();
  isLoading = true;

  const systemPrompt = settings.customPrompt;

  try {
    const response = await fetch(settings.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `网页标题: ${title}\n\n网页内容: ${content}` },
        ],
        max_tokens: 800,
        temperature: 0.3,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API 错误: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("API 不支持流式响应，请检查 API 配置");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let currentDelta = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") {
          await updateStreamingContent(fullText);
          isLoading = false;
          return;
        }

        try {
          const data = JSON.parse(dataStr);
          const delta = data.choices?.[0]?.delta?.content || data.choices?.[0]?.delta?.reasoning || "";
          if (delta) {
            fullText += delta;
            currentDelta += delta;

            if (currentDelta.length > 5 || delta.includes("\n")) {
              await appendStreamingContent(currentDelta);
              currentDelta = "";
            }
          }
        } catch (e) {}
      }
    }

    if (currentDelta) {
      fullText += currentDelta;
      await appendStreamingContent(currentDelta);
    }

    isLoading = false;
  } catch (error) {
    console.warn("流式失败，尝试非流式模式:", getErrorMessage(error));

    try {
      const response = await fetch(settings.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `网页标题: ${title}\n\n网页内容: ${content}` },
          ],
          max_tokens: 800,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `API 错误: ${response.status}`);
      }

      const data = await response.json();
      let summary = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || "";
      summary = summary.replace(/<concite>\s*/g, "").replace(/\s*<\/concite>/g, "");

      if (summary.trim()) {
        await updateStreamingContent(summary);
      } else {
        throw new Error("API 返回格式异常");
      }
    } catch (fallbackError) {
      console.error("非流式也失败:", fallbackError);
      showError(`⚠️ 总结失败: ${getErrorMessage(fallbackError)}`);
    }
    isLoading = false;
  }
}

function getPageContent() {
  const title = document.title || "";
  const bestEl = findBestContentElement();
  let content = bestEl.textContent.trim();

  if (content.length < 200) {
    const selectors = ["article", "main", '[role="main"]', ".post-content", ".article-content", ".entry-content", ".content", "#content", ".post", ".article", "body"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 200) {
        content = el.textContent.trim();
        break;
      }
    }
  }

  if (!content || content.length < 200) {
    content = document.body.textContent.trim();
  }

  content = content.replace(/\s+/g, " ").replace(/[\r\n]+/g, "\n").slice(0, 8000);
  return { title, content };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "summarize") {
    summarizePage();
  }
  if (message.action === "getCurrentDomain") {
    const hostname = window.location.hostname.replace(/^www\./, "");
    sendResponse({ hostname });
    return true;
  }
  return true;
});

chrome.storage.local.get(["enabled", "smartTrigger", "blockedSites", "autoWhitelist"], () => {
  setTimeout(autoSummarizePage, 800);
});
