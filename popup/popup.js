document.addEventListener("DOMContentLoaded", () => {
  const enabledToggle = document.getElementById("enabledToggle");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const domainText = document.getElementById("domainText");
  const summarizeBtn = document.getElementById("summarizeBtn");
  const blockBtn = document.getElementById("blockBtn");
  const blockBtnLabel = document.getElementById("blockBtnLabel");
  const blockBtnIcon = document.getElementById("blockBtnIcon");
  const settingsBtn = document.getElementById("settingsBtn");

  let currentDomain = "";
  let blockedSites = [];

  // 获取当前 tab 域名
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url) {
      try {
        currentDomain = new URL(tab.url).hostname.replace(/^www\./, "");
      } catch (e) {
        currentDomain = "";
      }
    }
    domainText.textContent = currentDomain;
    updateStatus();
  });

  // 加载设置
  chrome.storage.local.get(["enabled", "blockedSites"], (result) => {
    enabledToggle.checked = result.enabled !== false;
    blockedSites = result.blockedSites || [];
    updateStatus();
  });

  // 更新 UI 状态
  function updateStatus() {
    const isEnabled = enabledToggle.checked;
    const isBlocked =
      blockedSites.includes(currentDomain) ||
      blockedSites.includes(`.${currentDomain}`);

    if (!isEnabled) {
      statusDot.className = "status-dot paused";
      statusText.textContent = "已暂停";
    } else if (isBlocked) {
      statusDot.className = "status-dot paused";
      statusText.textContent = "当前网站已屏蔽";
    } else {
      statusDot.className = "status-dot active";
      statusText.textContent = "运行中";
    }

    if (isBlocked) {
      blockBtnLabel.textContent = "取消屏蔽此网站";
      blockBtnIcon.textContent = "×";
    } else {
      blockBtnLabel.textContent = "屏蔽此网站";
      blockBtnIcon.textContent = "+";
    }
  }

  // 切换启用
  enabledToggle.addEventListener("change", () => {
    const newEnabled = enabledToggle.checked;
    chrome.storage.local.set({ enabled: newEnabled }, updateStatus);
  });

  // 总结按钮
  summarizeBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "summarize" });
      }
    });
    window.close();
  });

  // 屏蔽按钮
  blockBtn.addEventListener("click", () => {
    if (!currentDomain) return;

    chrome.storage.local.get(["blockedSites"], (result) => {
      let sites = result.blockedSites || [];
      const isBlocked =
        sites.includes(currentDomain) || sites.includes(`.${currentDomain}`);

      if (isBlocked) {
        sites = sites.filter(
          (s) => s !== currentDomain && s !== `.${currentDomain}`,
        );
      } else {
        sites.push(currentDomain);
      }

      blockedSites = sites;
      chrome.storage.local.set({ blockedSites: sites }, updateStatus);
    });
  });

  // 设置按钮
  settingsBtn.addEventListener("click", () => {
    window.open(chrome.runtime.getURL("options/options.html"));
    window.close();
  });
});
