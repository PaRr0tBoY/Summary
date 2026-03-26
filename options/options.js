// Options Page
document.addEventListener("DOMContentLoaded", () => {
  const navItems = document.querySelectorAll(".nav-item");
  const tabContents = document.querySelectorAll(".tab-content");

  // Tab 切换
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const tab = item.dataset.tab;
      navItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      tabContents.forEach((c) => (c.style.display = "none"));
      document.getElementById(`tab-${tab}`).style.display = "block";
    });
  });

  // 加载设置
  chrome.storage.local.get(
    ["baseUrl", "model", "apiKey", "customPrompt", "enabled", "smartTrigger", "blockedSites", "autoWhitelist"],
    (result) => {
      document.getElementById("baseUrl").value = result.baseUrl || "";
      document.getElementById("model").value = result.model || "";
      document.getElementById("apiKey").value = result.apiKey || "";
      document.getElementById("customPrompt").value = result.customPrompt || "";
      document.getElementById("enabledToggle").checked = result.enabled !== false;
      document.getElementById("smartTriggerToggle").checked = result.smartTrigger !== false;
      document.getElementById("blockedSitesTextarea").value = (result.blockedSites || []).join("\n");
      document.getElementById("whitelistTextarea").value = (result.autoWhitelist || []).join("\n");
    }
  );

  // 保存设置
  document.getElementById("saveBtn").addEventListener("click", () => {
    const settings = {
      baseUrl: document.getElementById("baseUrl").value.trim(),
      model: document.getElementById("model").value.trim(),
      apiKey: document.getElementById("apiKey").value.trim(),
      customPrompt: document.getElementById("customPrompt").value.trim(),
      enabled: document.getElementById("enabledToggle").checked,
      smartTrigger: document.getElementById("smartTriggerToggle").checked,
    };
    chrome.storage.local.set(settings, () => {
      showMsg("saveMsg", "设置已保存", "success");
    });
  });

  // 测试连接
  document.getElementById("testBtn").addEventListener("click", async () => {
    const baseUrl = document.getElementById("baseUrl").value.trim();
    const model = document.getElementById("model").value.trim();
    const apiKey = document.getElementById("apiKey").value.trim();

    if (!baseUrl || !model || !apiKey) {
      showMsg("saveMsg", "请填写完整的 API 配置", "error");
      return;
    }

    showMsg("saveMsg", "测试中...", "success");

    try {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi" }], max_tokens: 10 }),
      });

      if (response.ok) {
        showMsg("saveMsg", "连接成功！", "success");
      } else {
        const err = await response.json().catch(() => ({}));
        showMsg("saveMsg", `错误: ${err.error?.message || response.status}`, "error");
      }
    } catch (e) {
      showMsg("saveMsg", `连接失败: ${e.message}`, "error");
    }
  });

  // 保存黑名单
  document.getElementById("saveBlocklistBtn").addEventListener("click", () => {
    const text = document.getElementById("blockedSitesTextarea").value;
    const sites = text.split("\n").map((s) => s.trim()).filter((s) => s);
    chrome.storage.local.set({ blockedSites: sites }, () => {
      showMsg("blocklistMsg", "黑名单已保存", "success");
    });
  });

  // 清空白名单
  document.getElementById("clearWhitelistBtn").addEventListener("click", () => {
    chrome.storage.local.set({ autoWhitelist: [] }, () => {
      document.getElementById("whitelistTextarea").value = "";
      showMsg("whitelistMsg", "白名单已清空", "success");
    });
  });

  // 导出
  document.getElementById("exportBtn").addEventListener("click", () => {
    chrome.storage.local.get(null, (data) => {
      delete data.enabled;
      delete data.smartTrigger;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "web-summarizer-backup.json";
      a.click();
      URL.revokeObjectURL(url);
      showMsg("exportMsg", "导出成功！", "success");
    });
  });

  // 导入
  const importFile = document.getElementById("importFile");
  document.getElementById("importBtn").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        chrome.storage.local.set(data, () => {
          location.reload();
        });
      } catch (err) {
        showMsg("backupMsg", "文件格式错误", "error");
      }
    };
    reader.readAsText(file);
  });

  function showMsg(id, text, type) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `msg show ${type}`;
    setTimeout(() => el.classList.remove("show"), 3000);
  }
});
