// content.js - 页面注入脚本

let isSelecting = false;
let startX, startY;
let selectionBox = null;
let overlay = null;
let hintEl = null;
let maskElements = [];
let currentMode = 'generate';

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startScreenshot") {
    currentMode = request.mode || 'generate';
    startScreenshotMode();
    sendResponse({ success: true });
  }
  if (request.action === "showError") {
    showErrorToast(request.error);
    sendResponse({ success: true });
  }
  if (request.action === "analyzeFromUrl") {
    analyzeImageFromUrl(request.imageUrl);
    sendResponse({ success: true });
  }
  if (request.action === "showLoading") {
    showResultPanel({ loading: true }, request.mode || currentMode);
    sendResponse({ success: true });
  }
  if (request.action === "showResult") {
    if (request.result && request.result.success) {
      showResultPanel(request.result.result, request.mode || currentMode);
    } else {
      showResultPanel({ error: request.result?.error || '分析失败' }, request.mode || currentMode);
    }
    sendResponse({ success: true });
  }
  if (request.action === "updatePrompt") {
    updatePromptText(request.text);
    sendResponse({ success: true });
  }
  return true;
});

// 流式更新提示词
function updatePromptText(text) {
  const promptText = document.getElementById('miampic-prompt-text');
  if (promptText) {
    promptText.value = text;
    promptText.scrollTop = promptText.scrollHeight;
  }
}

// 从 URL 分析图片
async function analyzeImageFromUrl(imageUrl) {
  showResultPanel({ loading: true, streaming: true });
}

// 显示错误提示
function showErrorToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #F0C8D8, #F5E6B8);
    color: #5A5A6A;
    padding: 12px 24px;
    border-radius: 12px;
    font-family: 'Nunito', sans-serif;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 20px rgba(100, 90, 120, 0.2);
    z-index: 2147483647;
    animation: slideDown 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideUp 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 截图模式
function startScreenshotMode() {
  if (isSelecting) return;
  isSelecting = true;

  // 创建提示
  hintEl = document.createElement('div');
  hintEl.className = 'miampic-screenshot-hint';
  hintEl.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5"></circle>
      <polyline points="21 15 16 10 5 21"></polyline>
    </svg>
    <span>拖动选择截图区域 · 按 ESC 取消</span>
  `;
  document.body.appendChild(hintEl);

  // 创建遮罩层容器
  const maskContainer = document.createElement('div');
  maskContainer.id = 'miampic-mask-container';
  document.body.appendChild(maskContainer);

  // 创建四个遮罩层
  const positions = ['top', 'right', 'bottom', 'left'];
  positions.forEach(pos => {
    const mask = document.createElement('div');
    mask.className = `miampic-mask miampic-mask-${pos}`;
    maskContainer.appendChild(mask);
    maskElements.push(mask);
  });

  // 创建透明交互层
  overlay = document.createElement('div');
  overlay.id = 'miampic-overlay';
  document.body.appendChild(overlay);

  // 创建选择框
  selectionBox = document.createElement('div');
  selectionBox.id = 'miampic-selection';
  selectionBox.innerHTML = `
    <div class="miampic-selection-size"></div>
    <div class="miampic-corner miampic-corner-tl"></div>
    <div class="miampic-corner miampic-corner-tr"></div>
    <div class="miampic-corner miampic-corner-bl"></div>
    <div class="miampic-corner miampic-corner-br"></div>
  `;
  document.body.appendChild(selectionBox);

  // 初始遮罩：全屏覆盖
  updateMaskPosition(0, 0, 0, 0);

  // 事件监听
  overlay.addEventListener('mousedown', onMouseDown);
  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
}

// 更新遮罩位置（实现镂空效果）
function updateMaskPosition(x, y, w, h) {
  if (maskElements.length !== 4) return;
  
  const [topMask, rightMask, bottomMask, leftMask] = maskElements;
  
  // 上边遮罩：从顶部到选区顶部
  topMask.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: ${y}px;
    background: rgba(60, 50, 80, 0.5);
    pointer-events: none;
    z-index: 2147483639;
  `;
  
  // 下边遮罩：从选区底部到底部
  bottomMask.style.cssText = `
    position: fixed;
    top: ${y + h}px;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(60, 50, 80, 0.5);
    pointer-events: none;
    z-index: 2147483639;
  `;
  
  // 左边遮罩：选区左侧
  leftMask.style.cssText = `
    position: fixed;
    top: ${y}px;
    left: 0;
    width: ${x}px;
    height: ${h}px;
    background: rgba(60, 50, 80, 0.5);
    pointer-events: none;
    z-index: 2147483639;
  `;
  
  // 右边遮罩：选区右侧
  rightMask.style.cssText = `
    position: fixed;
    top: ${y}px;
    left: ${x + w}px;
    right: 0;
    height: ${h}px;
    background: rgba(60, 50, 80, 0.5);
    pointer-events: none;
    z-index: 2147483639;
  `;
}

function onMouseDown(e) {
  if (!isSelecting) return;
  e.preventDefault();
  e.stopPropagation();
  
  startX = e.clientX;
  startY = e.clientY;
  selectionBox.style.display = 'block';
  selectionBox.style.left = startX + 'px';
  selectionBox.style.top = startY + 'px';
  selectionBox.style.width = '0';
  selectionBox.style.height = '0';
  selectionBox.querySelector('.miampic-selection-size').textContent = '';
}

function onMouseMove(e) {
  if (!isSelecting || startX === null) return;
  
  const currentX = e.clientX;
  const currentY = e.clientY;

  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  const w = Math.abs(currentX - startX);
  const h = Math.abs(currentY - startY);

  selectionBox.style.left = x + 'px';
  selectionBox.style.top = y + 'px';
  selectionBox.style.width = w + 'px';
  selectionBox.style.height = h + 'px';
  
  // 更新遮罩位置
  updateMaskPosition(x, y, w, h);
  
  // 显示选区尺寸
  selectionBox.querySelector('.miampic-selection-size').textContent = 
    w > 20 && h > 20 ? `${Math.round(w)} × ${Math.round(h)}` : '';
}

function onMouseUp(e) {
  if (!isSelecting || startX === null) return;
  e.preventDefault();
  e.stopPropagation();

  const endX = e.clientX;
  const endY = e.clientY;
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const w = Math.abs(endX - startX);
  const h = Math.abs(endY - startY);

  cleanupSelection();

  if (w > 10 && h > 10) {
    captureArea(x, y, w, h);
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    cleanupSelection();
  }
}

function cleanupSelection() {
  isSelecting = false;
  startX = null;
  startY = null;
  
  if (overlay) { 
    overlay.removeEventListener('mousedown', onMouseDown);
    overlay.removeEventListener('mousemove', onMouseMove);
    overlay.removeEventListener('mouseup', onMouseUp);
    overlay.remove(); 
    overlay = null; 
  }
  if (selectionBox) { 
    selectionBox.remove(); 
    selectionBox = null; 
  }
  if (hintEl) {
    hintEl.remove();
    hintEl = null;
  }
  
  // 移除遮罩容器
  const maskContainer = document.getElementById('miampic-mask-container');
  if (maskContainer) {
    maskContainer.remove();
  }
  maskElements = [];
  
  document.removeEventListener('keydown', onKeyDown);
}

// 截取指定区域
async function captureArea(x, y, w, h) {
  showResultPanel({ loading: true, streaming: true });

  const settings = await getSettings();
  if (!settings.apiKey) {
    showResultPanel({ error: '请先配置 API Key（点击扩展图标 → 设置）' });
    return;
  }

  chrome.runtime.sendMessage({
    action: "captureTab",
    area: { x, y, w, h, devicePixelRatio: window.devicePixelRatio }
  }, async (response) => {
    if (response && response.success) {
      chrome.runtime.sendMessage({
        action: "analyzeImageStream",
        imageData: response.imageData,
        settings: { ...settings, language: settings.language || 'zh', mode: currentMode }
      });
    } else {
      showResultPanel({ error: response?.error || '截图失败' });
    }
  });
}

// 获取设置
async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['apiKey', 'provider', 'model', 'language', 'mode'], resolve);
  });
}

// 显示结果弹窗
function showResultPanel(data, mode = 'generate') {
  removeResultPanel();
  resultPanel = document.createElement('div');
  resultPanel.id = 'miampic-panel';
  
  // 提示词用途标签
  const modeLabel = mode === 'assist' ? '辅助改图' : '直接生图';
  const modeIcon = mode === 'assist' 
    ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`
    : `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
  
  if (data.loading) {
    resultPanel.innerHTML = `
      <div class="miampic-panel-header">
        <div class="miampic-logo">
          <svg viewBox="0 0 128 128" width="24" height="24">
            <defs>
              <linearGradient id="catGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#B8A9E8"/>
                <stop offset="50%" style="stop-color:#A8D8B8"/>
                <stop offset="100%" style="stop-color:#F5E6B8"/>
              </linearGradient>
            </defs>
            <rect x="4" y="4" width="120" height="120" rx="24" fill="url(#catGrad2)"/>
            <g fill="#5D5A6E">
              <ellipse cx="62" cy="98" rx="24" ry="20"/>
              <path d="M 85 95 Q 98 88, 102 75 Q 105 65, 102 58 Q 100 54, 97 56 Q 94 60, 94 68 Q 94 80, 82 92 Z" fill="#5D5A6E"/>
              <ellipse cx="62" cy="58" rx="32" ry="28"/>
              <polygon points="36,32 46,58 26,50"/>
              <polygon points="88,32 78,58 98,50"/>
              <ellipse cx="50" cy="54" rx="6" ry="7" fill="#FFF"/>
              <ellipse cx="74" cy="54" rx="6" ry="7" fill="#FFF"/>
              <circle cx="51" cy="55" r="3.5" fill="#3D3A4E"/>
              <circle cx="75" cy="55" r="3.5" fill="#3D3A4E"/>
              <ellipse cx="62" cy="66" rx="4" ry="2.5" fill="#E8A0B0"/>
            </g>
          </svg>
          <span>Miampic</span>
        </div>
        <button class="miampic-close" id="miampic-close-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="miampic-body">
        <div class="miampic-mode-tag">${modeIcon} ${modeLabel}</div>
        <textarea class="miampic-prompt-editor miampic-prompt-loading" id="miampic-prompt-text" placeholder="正在生成提示词..." readonly></textarea>
        <div class="miampic-loading-indicator">
          <div class="miampic-spinner"></div>
          <span>AI 正在分析...</span>
        </div>
      </div>
    `;
  } else if (data.error) {
    resultPanel.innerHTML = `
      <div class="miampic-panel-header">
        <div class="miampic-logo">
          <svg viewBox="0 0 128 128" width="24" height="24">
            <defs>
              <linearGradient id="catGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#B8A9E8"/>
                <stop offset="50%" style="stop-color:#A8D8B8"/>
                <stop offset="100%" style="stop-color:#F5E6B8"/>
              </linearGradient>
            </defs>
            <rect x="4" y="4" width="120" height="120" rx="24" fill="url(#catGrad3)"/>
            <g fill="#5D5A6E">
              <ellipse cx="62" cy="98" rx="24" ry="20"/>
              <path d="M 85 95 Q 98 88, 102 75 Q 105 65, 102 58 Q 100 54, 97 56 Q 94 60, 94 68 Q 94 80, 82 92 Z" fill="#5D5A6E"/>
              <ellipse cx="62" cy="58" rx="32" ry="28"/>
              <polygon points="36,32 46,58 26,50"/>
              <polygon points="88,32 78,58 98,50"/>
              <ellipse cx="50" cy="54" rx="6" ry="7" fill="#FFF"/>
              <ellipse cx="74" cy="54" rx="6" ry="7" fill="#FFF"/>
              <circle cx="51" cy="55" r="3.5" fill="#3D3A4E"/>
              <circle cx="75" cy="55" r="3.5" fill="#3D3A4E"/>
              <ellipse cx="62" cy="66" rx="4" ry="2.5" fill="#E8A0B0"/>
            </g>
          </svg>
          <span>Miampic</span>
        </div>
        <button class="miampic-close" id="miampic-close-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="miampic-error">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#E8A0A0" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>${data.error}</p>
        <button class="miampic-btn miampic-btn-retry" id="miampic-retry-btn">关闭</button>
      </div>
    `;
  } else {
    resultPanel.innerHTML = `
      <div class="miampic-panel-header">
        <div class="miampic-logo">
          <svg viewBox="0 0 128 128" width="24" height="24">
            <defs>
              <linearGradient id="catGrad4" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#B8A9E8"/>
                <stop offset="50%" style="stop-color:#A8D8B8"/>
                <stop offset="100%" style="stop-color:#F5E6B8"/>
              </linearGradient>
            </defs>
            <rect x="4" y="4" width="120" height="120" rx="24" fill="url(#catGrad4)"/>
            <g fill="#5D5A6E">
              <ellipse cx="62" cy="98" rx="24" ry="20"/>
              <path d="M 85 95 Q 98 88, 102 75 Q 105 65, 102 58 Q 100 54, 97 56 Q 94 60, 94 68 Q 94 80, 82 92 Z" fill="#5D5A6E"/>
              <ellipse cx="62" cy="58" rx="32" ry="28"/>
              <polygon points="36,32 46,58 26,50"/>
              <polygon points="88,32 78,58 98,50"/>
              <ellipse cx="50" cy="54" rx="6" ry="7" fill="#FFF"/>
              <ellipse cx="74" cy="54" rx="6" ry="7" fill="#FFF"/>
              <circle cx="51" cy="55" r="3.5" fill="#3D3A4E"/>
              <circle cx="75" cy="55" r="3.5" fill="#3D3A4E"/>
              <ellipse cx="62" cy="66" rx="4" ry="2.5" fill="#E8A0B0"/>
            </g>
          </svg>
          <span>Miampic</span>
        </div>
        <button class="miampic-close" id="miampic-close-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="miampic-body">
        <div class="miampic-mode-tag">${modeIcon} ${modeLabel}</div>
        <textarea class="miampic-prompt-editor" id="miampic-prompt-text">${data.prompt || ''}</textarea>
        <div class="miampic-actions">
          <button class="miampic-btn miampic-btn-translate" id="miampic-translate-btn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            翻译
          </button>
          <button class="miampic-btn miampic-btn-copy" id="miampic-copy-btn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            复制
          </button>
        </div>
        <div class="miampic-footer-links">
          <a href="https://www.doubao.com/chat/create-image" target="_blank" class="miampic-doubao-link">
            跳转豆包生图
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </a>
        </div>
      </div>
      <div class="miampic-success-animation" id="miampic-success-anim">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#A8D8B8" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="17 8 10 15 7 12"></polyline>
        </svg>
      </div>
    `;
  }

  document.body.appendChild(resultPanel);
  
  // 绑定事件
  document.getElementById('miampic-close-btn')?.addEventListener('click', removeResultPanel);
  
  if (data.error) {
    document.getElementById('miampic-retry-btn')?.addEventListener('click', removeResultPanel);
  }
  
  if (!data.loading && !data.error) {
    const promptText = document.getElementById('miampic-prompt-text');
    
    // 保存原文和译文状态
    const originalText = promptText.value;
    let translatedText = null;
    let isTranslated = false;
    
    // 显示成功动画
    setTimeout(() => {
      const successAnim = document.getElementById('miampic-success-anim');
      if (successAnim) {
        successAnim.classList.add('show');
        setTimeout(() => successAnim.classList.remove('show'), 1500);
      }
    }, 100);
    
    // 翻译按钮
    const translateBtn = document.getElementById('miampic-translate-btn');
    translateBtn?.addEventListener('click', async () => {
      // 如果已经翻译过，切换回原文
      if (isTranslated && translatedText) {
        promptText.value = originalText;
        isTranslated = false;
        translateBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
          </svg>
          翻译
        `;
        return;
      }
      
      // 执行翻译
      const settings = await getSettings();
      
      translateBtn.disabled = true;
      translateBtn.innerHTML = `<div class="miampic-spinner-small"></div> 翻译中...`;
      
      chrome.runtime.sendMessage({
        action: 'translatePrompt',
        prompt: promptText.value,
        settings: { ...settings, targetLang: 'en' }
      }, (result) => {
        translateBtn.disabled = false;
        if (result && result.success) {
          translatedText = result.result;
          promptText.value = translatedText;
          isTranslated = true;
          translateBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            原文
          `;
        } else {
          translateBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            翻译
          `;
          showErrorToast(result?.error || '翻译失败');
        }
      });
    });
    
    // 复制按钮
    document.getElementById('miampic-copy-btn')?.addEventListener('click', () => {
      const text = promptText.value;
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('miampic-copy-btn');
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          已复制
        `;
        btn.classList.add('miampic-btn-success');
        setTimeout(() => {
          btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            复制
          `;
          btn.classList.remove('miampic-btn-success');
        }, 2000);
      });
    });
  }

  makeDraggable(resultPanel);
}

let resultPanel = null;

function removeResultPanel() {
  if (resultPanel) {
    resultPanel.remove();
    resultPanel = null;
  }
}

// 保存弹窗位置
let savedPanelPosition = null;

// 使面板可拖动
function makeDraggable(el) {
  const header = el.querySelector('.miampic-panel-header');
  if (!header) return;
  
  let isDragging = false;
  let offsetX, offsetY;

  // 使用保存的位置，否则使用默认位置
  if (savedPanelPosition) {
    el.style.right = 'auto';
    el.style.left = savedPanelPosition.left + 'px';
    el.style.top = savedPanelPosition.top + 'px';
  } else {
    el.style.right = '20px';
    el.style.top = '80px';
  }

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.miampic-close')) return;
    isDragging = true;
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    el.style.right = 'auto';
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.cursor = 'grabbing';
    e.preventDefault();
  });

  const onMouseMove = (e) => {
    if (!isDragging) return;
    
    let newLeft = e.clientX - offsetX;
    let newTop = e.clientY - offsetY;
    
    const maxLeft = window.innerWidth - el.offsetWidth - 10;
    const maxTop = window.innerHeight - el.offsetHeight - 10;
    
    newLeft = Math.max(10, Math.min(newLeft, maxLeft));
    newTop = Math.max(10, Math.min(newTop, maxTop));
    
    el.style.left = newLeft + 'px';
    el.style.top = newTop + 'px';
  };

  const onMouseUp = () => { 
    isDragging = false;
    el.style.cursor = '';
    // 保存位置
    savedPanelPosition = {
      left: parseInt(el.style.left),
      top: parseInt(el.style.top)
    };
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes slideDown {
    from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
    to { transform: translateX(-50%) translateY(0); opacity: 1; }
  }
  @keyframes slideUp {
    from { transform: translateX(-50%) translateY(0); opacity: 1; }
    to { transform: translateX(-50%) translateY(-20px); opacity: 0; }
  }
`;
document.head.appendChild(style);
