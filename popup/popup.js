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

// 初始化
async function init() {
  const settings = await loadSettings();
  
  if (!settings.apiKey) {
    apiWarning.style.display = 'block';
    mainActions.style.display = 'none';
  } else {
    apiWarning.style.display = 'none';
    mainActions.style.display = 'flex';
  }
  
  // 恢复保存的模式
  if (settings.mode) {
    modeSelect.value = settings.mode;
  }
}

init();

// 加载设置
function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['apiKey', 'provider', 'model', 'language', 'mode'], resolve);
  });
}

// 模式切换
modeSelect.addEventListener('change', () => {
  // 保存模式
  chrome.storage.sync.set({ mode: modeSelect.value });
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
  
  // 发送消息给 content script 启动截图模式
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { 
    action: 'startScreenshot',
    mode: modeSelect.value
  }, (response) => {
    // 截图模式已启动，关闭 popup
    window.close();
  });
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
    return;
  }
  
  // 读取图片
  const reader = new FileReader();
  reader.onload = async (event) => {
    const base64 = event.target.result.split(',')[1];
    
    // 获取当前标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 发送消息给 background 开始分析，带上 tabId 和模式
    chrome.runtime.sendMessage({
      action: "analyzeImageFromPopup",
      imageData: { base64, mediaType: file.type || 'image/jpeg' },
      settings: { ...settings, language: settings.language || 'zh', mode: modeSelect.value },
      tabId: tab.id
    });
    
    // 关闭 popup
    window.close();
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});
