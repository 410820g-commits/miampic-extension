// popup.js - Miampic 弹窗逻辑

// DOM 元素
const settingsBtn = document.getElementById('settingsBtn');
const setupBtn = document.getElementById('setupBtn');
const screenshotBtn = document.getElementById('screenshotBtn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const apiWarning = document.getElementById('apiWarning');
const mainActions = document.getElementById('mainActions');
const modeSelect = document.getElementById('modeSelect');
const aspectRatioSelect = document.getElementById('aspectRatioSelect');

const UNSUPPORTED_PAGE_MESSAGE = '当前页面不支持显示 Miampic 弹窗。请在普通网页中使用，或刷新当前网页后再试。';

// 初始化
async function init() {
  const settings = await loadSettings();
  applyTheme(settings.theme || 'light');
  
  if (!settings.apiKey) {
    apiWarning.style.display = 'block';
    mainActions.style.display = 'none';
  } else {
    apiWarning.style.display = 'none';
    mainActions.style.display = 'flex';
  }
  
  // 恢复保存的模式和图片比例
  if (settings.mode) {
    modeSelect.value = settings.mode;
  }
  aspectRatioSelect.value = settings.aspectRatio || '9:16';
}

init();

// 加载设置
function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['apiKey', 'provider', 'model', 'language', 'mode', 'theme', 'aspectRatio'], resolve);
  });
}

function applyTheme(theme) {
  document.body.classList.toggle('theme-dark', theme === 'dark');
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.theme) {
    applyTheme(changes.theme.newValue || 'light');
  }
});

function getActiveTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]);
}

function isRestrictedPage(tab) {
  const url = tab?.url || '';
  if (!tab?.id || !url) return true;

  return [
    'chrome://',
    'edge://',
    'about:',
    'chrome-extension://',
    'moz-extension://'
  ].some(prefix => url.startsWith(prefix)) ||
    url.includes('chromewebstore.google.com') ||
    url.includes('microsoftedge.microsoft.com/addons');
}

function sendTabMessage(tabId, message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const error = chrome.runtime.lastError;
      resolve({ ok: !error && response?.success !== false, response, error: error?.message });
    });
  });
}

async function ensurePageCanShowPanel(tab) {
  if (isRestrictedPage(tab)) {
    alert(UNSUPPORTED_PAGE_MESSAGE);
    return false;
  }
  return true;
}

// 模式切换
modeSelect.addEventListener('change', () => {
  // 保存模式
  chrome.storage.sync.set({ mode: modeSelect.value });
});

aspectRatioSelect.addEventListener('change', () => {
  chrome.storage.sync.set({ aspectRatio: aspectRatioSelect.value });
});

// 打开设置页
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

setupBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 截图按钮
screenshotBtn.addEventListener('click', async () => {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    alert('请先配置 API Key');
    return;
  }
  
  const tab = await getActiveTab();
  if (!(await ensurePageCanShowPanel(tab))) return;

  // 发送消息给 content script 启动截图模式
  const result = await sendTabMessage(tab.id, { 
    action: 'startScreenshot',
    mode: modeSelect.value,
    aspectRatio: aspectRatioSelect.value
  });

  if (!result.ok) {
    alert(UNSUPPORTED_PAGE_MESSAGE);
    return;
  }

  // 截图模式已启动，关闭 popup
  window.close();
});

// 上传图片
uploadBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const settings = await loadSettings();
  if (!settings.apiKey) {
    alert('请先配置 API Key');
    fileInput.value = '';
    return;
  }
  
  // 读取图片
  const reader = new FileReader();
  reader.onload = async (event) => {
    const base64 = event.target.result.split(',')[1];
    const tab = await getActiveTab();

    if (!(await ensurePageCanShowPanel(tab))) {
      fileInput.value = '';
      return;
    }

    // 先确认当前页面能显示结果面板，避免上传后无反馈。
    const panelReady = await sendTabMessage(tab.id, {
      action: 'showLoading',
      mode: modeSelect.value,
      aspectRatio: aspectRatioSelect.value
    });

    if (!panelReady.ok) {
      alert(UNSUPPORTED_PAGE_MESSAGE);
      fileInput.value = '';
      return;
    }
    
    // 发送消息给 background 开始分析，带上 tabId 和模式
    chrome.runtime.sendMessage({
      action: 'analyzeImageFromPopup',
      imageData: { base64, mediaType: file.type || 'image/jpeg' },
      settings: { ...settings, language: settings.language || 'zh', mode: modeSelect.value, aspectRatio: aspectRatioSelect.value },
      tabId: tab.id
    }, response => {
      if (chrome.runtime.lastError || response?.success === false) {
        alert(response?.error || chrome.runtime.lastError?.message || '上传分析启动失败，请稍后重试。');
        return;
      }
      window.close();
    });
  };
  reader.onerror = () => {
    alert('读取图片失败，请换一张图片再试。');
    fileInput.value = '';
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});

