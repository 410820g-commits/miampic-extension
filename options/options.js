// options.js - Miampic 设置页逻辑

// DOM 元素
const providerSelect = document.getElementById('provider');
const modelSelect = document.getElementById('model');
const apiKeyInput = document.getElementById('apiKey');
const languageSelect = document.getElementById('language');
const modeSelect = document.getElementById('mode');
const settingsForm = document.getElementById('settingsForm');
const toggleKeyBtn = document.getElementById('toggleKeyVisibility');
const getApiKeyBtn = document.getElementById('getApiKeyBtn');
const apiKeyModal = document.getElementById('apiKeyModal');
const closeApiKeyModal = document.getElementById('closeApiKeyModal');
const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// 当前设置
let currentSettings = {
  provider: 'siliconflow',
  model: 'zai-org/GLM-4.5V',
  apiKey: '',
  language: 'zh',
  mode: 'generate'
};

// Tab 切换
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// 加载设置
async function loadSettings() {
  const settings = await chrome.storage.sync.get(['provider', 'model', 'apiKey', 'language', 'mode']);
  currentSettings = { ...currentSettings, ...settings };
  
  // 更新 UI
  providerSelect.value = currentSettings.provider;
  apiKeyInput.value = currentSettings.apiKey || '';
  languageSelect.value = currentSettings.language || 'zh';
  modeSelect.value = currentSettings.mode || 'generate';
  
  // 根据提供商更新模型选项
  updateModelOptions();
}

// 更新模型选项
function updateModelOptions() {
  const provider = providerSelect.value;
  modelSelect.innerHTML = '';
  
  if (provider === 'siliconflow') {
    const opt = document.createElement('option');
    opt.value = 'zai-org/GLM-4.5V';
    opt.textContent = 'GLM-4.5V (硅基流动)';
    modelSelect.appendChild(opt);
  } else if (provider === 'gemini') {
    const opt = document.createElement('option');
    opt.value = 'gemini-2.0-flash';
    opt.textContent = 'Gemini 2.0 Flash';
    modelSelect.appendChild(opt);
  }
  
  currentSettings.model = modelSelect.value;
}

// 加载历史记录
async function loadHistory() {
  const data = await chrome.storage.local.get(['promptHistory']);
  const history = data.promptHistory || [];
  
  historyCount.textContent = `${history.length} 条记录`;
  
  if (history.length === 0) {
    historyList.innerHTML = `
      <div class="history-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <p>暂无历史记录</p>
        <p class="hint-text">生成的提示词将自动保存在这里</p>
      </div>
    `;
    return;
  }
  
  // 显示最近 15 条
  const recentHistory = history.slice(-15).reverse();
  historyList.innerHTML = recentHistory.map((item, index) => {
    const realIndex = history.length - 1 - index;
    const modeText = item.mode === 'assist' ? '辅助改图' : '直接生图';
    const modeIcon = item.mode === 'assist' 
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
    
    return `
      <div class="history-item" data-index="${realIndex}">
        <div class="history-item-header">
          <span class="history-item-time">${formatTime(item.timestamp)}</span>
          <div class="history-item-actions">
            <button class="btn-action history-copy" data-index="${realIndex}" title="复制">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              复制
            </button>
            <button class="btn-action danger history-delete" data-index="${realIndex}" title="删除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="history-item-prompt">${escapeHtml(item.prompt)}</div>
        <div class="history-item-footer">
          <span class="history-mode-tag">${modeIcon} ${modeText}</span>
        </div>
      </div>
    `;
  }).join('');
  
  // 绑定复制事件
  document.querySelectorAll('.history-copy').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const index = parseInt(e.currentTarget.dataset.index);
      const data = await chrome.storage.local.get(['promptHistory']);
      const history = data.promptHistory || [];
      if (history[index]) {
        navigator.clipboard.writeText(history[index].prompt);
        const originalHtml = e.currentTarget.innerHTML;
        e.currentTarget.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          已复制
        `;
        e.currentTarget.classList.add('success');
        setTimeout(() => {
          e.currentTarget.innerHTML = originalHtml;
          e.currentTarget.classList.remove('success');
        }, 1500);
      }
    });
  });
  
  // 绑定删除事件
  document.querySelectorAll('.history-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const index = parseInt(e.currentTarget.dataset.index);
      await deleteHistoryItem(index);
    });
  });
}

// 删除单条历史
async function deleteHistoryItem(index) {
  const data = await chrome.storage.local.get(['promptHistory']);
  const history = data.promptHistory || [];
  history.splice(index, 1);
  await chrome.storage.local.set({ promptHistory: history });
  loadHistory();
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  
  return date.toLocaleDateString('zh-CN');
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 事件监听
providerSelect.addEventListener('change', () => {
  currentSettings.provider = providerSelect.value;
  updateModelOptions();
});

modelSelect.addEventListener('change', () => {
  currentSettings.model = modelSelect.value;
});

// API Key 显示/隐藏
toggleKeyBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  toggleKeyBtn.innerHTML = isPassword 
    ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>`
    : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>`;
});

// 获取 API Key 弹窗
getApiKeyBtn.addEventListener('click', () => {
  apiKeyModal.classList.add('show');
});

closeApiKeyModal.addEventListener('click', () => {
  apiKeyModal.classList.remove('show');
});

// 点击遮罩关闭弹窗
apiKeyModal.addEventListener('click', (e) => {
  if (e.target === apiKeyModal) {
    apiKeyModal.classList.remove('show');
  }
});

// 清空历史
clearHistoryBtn.addEventListener('click', async () => {
  if (confirm('确定要清空所有历史记录吗？')) {
    await chrome.storage.local.remove(['promptHistory']);
    loadHistory();
  }
});

// 保存设置
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const settings = {
    provider: currentSettings.provider,
    model: currentSettings.model,
    apiKey: apiKeyInput.value.trim(),
    language: languageSelect.value,
    mode: modeSelect.value
  };
  
  await chrome.storage.sync.set(settings);
  
  // 显示成功提示
  const btn = settingsForm.querySelector('button[type="submit"]');
  const originalText = btn.innerHTML;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    已保存
  `;
  btn.classList.add('success');
  
  setTimeout(() => {
    btn.innerHTML = originalText;
    btn.classList.remove('success');
  }, 2000);
});

// 初始化
loadSettings();
loadHistory();
