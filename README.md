# Web Summarizer

[English](#english) | [中文](#中文)

---

## 中文

### 项目简介

一个 AI 驱动的 Chrome 浏览器扩展，自动识别网页标题与正文，生成流式摘要。

### 功能特性

- **智能内容识别**：内置简化版 Readability 算法，自动识别文章主体区域
- **流式输出**：SSE 流式响应，实时展示摘要生成过程
- **自动触发**：白名单优先 + 黑名单过滤 + 智能评分，精准判断何时自动总结
- **手动触发**：一键总结当前页面，绕过智能检测
- **内联渲染**：无外部依赖，内置 Markdown 解析器
- **主题适配**：根据页面背景色动态调整卡片样式
- **可配置 API**：支持任意 OpenAI 兼容 API

### 安装方式

1. 克隆仓库：
   ```bash
git clone https://github.com/PaRr0tBoY/Summary.git
```

2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择克隆的 `Summary` 目录

### 配置说明


点击扩展图标 → 设置，可配置：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API 地址 | OpenAI 兼容 API URL | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| 模型 | 模型名称 | `glm-4-flash` |
| API Key | 访问令牌 | (需用户填写) |
| 自定义提示词 | 系统提示词模板 | 内置默认模板 |
| 自动触发 | 是否启用智能自动触发 | 开启 |
| 屏蔽网站 | 排除的域名列表 | [] |

### 使用方法

- **自动模式**：访问文章类页面时自动生成摘要
- **手动模式**：点击扩展图标 → 「总结当前页面」
- **屏蔽网站**：点击「屏蔽此网站」排除当前域名

### 技术栈

- Manifest V3
- 纯 JavaScript（无框架）
- 内联 Markdown + LaTeX 渲染
- `chrome.storage.local` 持久化配置
- Fetch API + SSE 流式响应

### 项目结构

```
Summary/
├── manifest.json          # 扩展清单
├── content/content.js     # 核心：摘要生成、流式渲染
├── background/service-worker.js
├── popup/popup.html + popup.js
└── options/options.html + options.js
```

---

## English

### Project Overview

AI-powered Chrome extension that automatically identifies web page titles and generates streaming content summaries.

### Features

- **Smart Content Detection**: Built-in simplified Readability algorithm for article body detection
- **Streaming Output**: SSE streaming response, real-time summary generation
- **Auto-Trigger**: Whitelist-first + blacklist filtering + intelligent scoring
- **Manual Trigger**: One-click summary, bypass smart detection
- **Inline Rendering**: No external dependencies, built-in Markdown parser
- **Theme Adaptation**: Dynamic card styling based on page background
- **Configurable API**: Supports any OpenAI-compatible API

### Installation

1. Clone the repo:
   ```bash
git clone https://github.com/PaRr0tBoY/Summary.git
```

2. Open Chrome, navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the cloned `Summary` directory

### Configuration


Click extension icon → Settings:

| Option | Description | Default |
|--------|-------------|---------|
| API URL | OpenAI-compatible API endpoint | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| Model | Model name | `glm-4-flash` |
| API Key | Access token | (user-filled) |
| Custom Prompt | System prompt template | Built-in default |
| Auto-Trigger | Enable smart auto-trigger | On |
| Blocked Sites | Excluded domain list | [] |

### Usage

- **Auto Mode**: Automatically generates summary when visiting article pages
- **Manual Mode**: Click extension icon → "Summarize Current Page"
- **Block Site**: Click "Block This Site" to exclude current domain

### Tech Stack

- Manifest V3
- Vanilla JavaScript (no framework)
- Inline Markdown + LaTeX rendering
- `chrome.storage.local` for persistence
- Fetch API + SSE streaming

### Project Structure

```
Summary/
├── manifest.json          # Extension manifest
├── content/content.js     # Core: summary generation, streaming
├── background/service-worker.js
├── popup/popup.html + popup.js
└── options/options.html + options.js
```

---

### License

MIT