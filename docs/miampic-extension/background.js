// background.js - Service Worker for Miampic

// API 提供商配置
const API_PROVIDERS = {
  siliconflow: {
    name: '硅基流动',
    type: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    visionModels: ['zai-org/GLM-4.5V'],
  },
  gemini: {
    name: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    visionModels: ['gemini-2.0-flash'],
  }
};

// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "analyzeImage",
    title: "生成图片提示词",
    contexts: ["image"]
  });
});

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "analyzeImage" && info.srcUrl) {
    // 获取设置
    const settings = await chrome.storage.sync.get(['apiKey', 'provider', 'model', 'language', 'mode', 'aspectRatio']);
    if (!settings.apiKey) {
      chrome.tabs.sendMessage(tab.id, {
        action: "showError",
        error: '请先配置 API Key。点击扩展图标进行设置。'
      });
      return;
    }
    
    // 显示加载状态
    chrome.tabs.sendMessage(tab.id, { action: "showLoading", mode: settings.mode || 'generate', aspectRatio: settings.aspectRatio || '9:16' });
    
    try {
      let imageData = null;
      const imageUrl = info.srcUrl;
      
      console.log('[Miampic] Processing image URL:', imageUrl.substring(0, 100));
      
      // 检查是否是 data URL
      if (imageUrl.startsWith('data:')) {
        const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          imageData = {
            base64: matches[2].replace(/\s/g, ''), // 移除所有空白字符
            mediaType: normalizeMediaType(matches[1])
          };
          console.log('[Miampic] Data URL detected, mediaType:', imageData.mediaType);
        }
      }
      
      // 方法1: 通过 content script 获取（使用 canvas 绘制）- 优先使用
      if (!imageData) {
        try {
          imageData = await fetchImageViaCanvas(tab.id, imageUrl);
          if (imageData) {
            imageData.base64 = imageData.base64.replace(/\s/g, '');
            imageData.mediaType = normalizeMediaType(imageData.mediaType);
            console.log('[Miampic] Canvas method success, mediaType:', imageData.mediaType);
          }
        } catch (e) {
          console.log('[Miampic] Method 1 (canvas) failed:', e.message);
        }
      }
      
      // 方法2: 直接 fetch（适用于同源或允许跨域的图片）
      if (!imageData) {
        try {
          imageData = await fetchImageAsBase64(imageUrl);
          if (imageData) {
            imageData.base64 = imageData.base64.replace(/\s/g, '');
            imageData.mediaType = normalizeMediaType(imageData.mediaType);
            console.log('[Miampic] Fetch method success, mediaType:', imageData.mediaType);
          }
        } catch (e) {
          console.log('[Miampic] Method 2 (fetch) failed:', e.message);
        }
      }
      
      if (!imageData || !imageData.base64) {
        throw new Error('无法获取图片数据，可能是跨域限制');
      }
      
      // 验证 base64 数据
      if (imageData.base64.length < 100) {
        throw new Error('图片数据太小，可能获取失败');
      }
      
      console.log('[Miampic] Image data ready, base64 length:', imageData.base64.length);
      
      // 调用 API 分析（流式）
      await analyzeImageStream(imageData, settings, tab.id);
    } catch (error) {
      console.error('[Miampic] Error:', error);
      chrome.tabs.sendMessage(tab.id, {
        action: "showResult",
        result: { success: false, error: `获取图片失败: ${error.message}` }
      });
    }
  }
});

// 规范化媒体类型
function normalizeMediaType(mediaType) {
  if (!mediaType) return 'image/png';
  const mt = mediaType.toLowerCase().trim();
  // 确保是有效的图片类型
  if (['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(mt)) {
    return mt === 'image/jpg' ? 'image/jpeg' : mt;
  }
  return 'image/png';
}

function normalizeAspectRatio(aspectRatio) {
  const value = String(aspectRatio || '9:16').replace('：', ':').trim();
  return /^\d{1,2}:\d{1,2}$/.test(value) ? value : '9:16';
}

// 通过 canvas 获取图片数据（绕过 CORS）
async function fetchImageViaCanvas(tabId, imageUrl) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (url) => {
        return new Promise((resolve) => {
          console.log('[Miampic Canvas] Starting to load image:', url.substring(0, 100));
          
          // 创建一个隐藏的图片元素
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          img.onload = () => {
            console.log('[Miampic Canvas] Image loaded, size:', img.naturalWidth, 'x', img.naturalHeight);
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              
              // 尝试获取 PNG 数据
              let dataUrl = canvas.toDataURL('image/png');
              const base64 = dataUrl.split(',')[1];
              console.log('[Miampic Canvas] Success with crossOrigin, base64 length:', base64.length);
              resolve({
                base64: base64,
                mediaType: 'image/png',
                width: img.naturalWidth,
                height: img.naturalHeight
              });
            } catch (e) {
              console.log('[Miampic Canvas] CORS tainted, trying jpeg:', e.message);
              // 如果 CORS 污染，尝试使用 jpeg 格式
              try {
                const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                const base64 = dataUrl.split(',')[1];
                resolve({
                  base64: base64,
                  mediaType: 'image/jpeg'
                });
              } catch (e2) {
                console.log('[Miampic Canvas] JPEG also failed:', e2.message);
                resolve(null);
              }
            }
          };
          
          img.onerror = (e) => {
            console.log('[Miampic Canvas] Image load error with crossOrigin, trying without');
            // 尝试不带 crossOrigin
            const img2 = new Image();
            img2.onload = () => {
              console.log('[Miampic Canvas] Image loaded without crossOrigin, size:', img2.naturalWidth, 'x', img2.naturalHeight);
              try {
                const canvas = document.createElement('canvas');
                canvas.width = img2.naturalWidth;
                canvas.height = img2.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img2, 0, 0);
                const dataUrl = canvas.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                console.log('[Miampic Canvas] Success without crossOrigin, base64 length:', base64.length);
                resolve({
                  base64: base64,
                  mediaType: 'image/png'
                });
              } catch (e3) {
                console.log('[Miampic Canvas] Final attempt failed:', e3.message);
                resolve(null);
              }
            };
            img2.onerror = () => {
              console.log('[Miampic Canvas] All attempts failed');
              resolve(null);
            };
            img2.src = url;
          };
          
          img.src = url;
        });
      },
      args: [imageUrl]
    });
    
    return results?.[0]?.result || null;
  } catch (error) {
    console.error('[Miampic] fetchImageViaCanvas error:', error);
    return null;
  }
}

// 获取图片并转为 base64
async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve({ base64, mediaType: blob.type || 'image/png' });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    throw new Error(`无法获取图片: ${error.message}`);
  }
}

// 流式分析图片
async function analyzeImageStream(imageData, settings, tabId) {
  const { base64, mediaType } = imageData;
  const { provider, apiKey, model, language, mode, aspectRatio } = settings;

  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig) {
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: false, error: '未知的 API 提供商' }
    });
    return;
  }

  const systemPrompt = buildSystemPrompt(language || 'zh', mode || 'generate', aspectRatio || '9:16');
  const userText = language === 'zh' 
    ? '请分析这张图片，生成图像生成提示词。' 
    : 'Analyze this image and generate an image generation prompt.';

  // 根据提供商类型选择不同的 API 格式
  if (providerConfig.type === 'gemini') {
    await analyzeWithGemini(base64, mediaType, systemPrompt, userText, apiKey, model || providerConfig.visionModels[0], tabId, mode, aspectRatio);
  } else {
    await analyzeWithOpenAI(base64, mediaType, systemPrompt, userText, providerConfig, apiKey, model, tabId, mode, language, aspectRatio);
  }
}

// 读取 SSE 流，保留跨 chunk 的半截事件，避免 JSON 被拆包时丢字。
async function readSSEStream(response, onData) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('当前 API 响应不支持流式读取');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const consumeEvent = (eventText) => {
    const dataLines = eventText
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.replace(/^data:\s?/, ''));

    if (dataLines.length === 0) return;

    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') return;

    onData(data);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';

    for (const eventText of events) {
      consumeEvent(eventText);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    consumeEvent(buffer);
  }
}
// Gemini API 调用
async function analyzeWithGemini(base64, mediaType, systemPrompt, userText, apiKey, model, tabId, mode, aspectRatio) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
  
  const body = {
    contents: [{
      parts: [
        { text: systemPrompt + '\n\n' + userText },
        { inline_data: { mime_type: mediaType, data: base64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      let errorMsg = `API 错误 (${response.status})`;
      try {
        const errData = JSON.parse(errText);
        errorMsg = errData.error?.message || errorMsg;
      } catch (e) {
        errorMsg = errText || errorMsg;
      }
      chrome.tabs.sendMessage(tabId, {
        action: "showResult",
        result: { success: false, error: errorMsg }
      });
      return;
    }

    // 流式读取
    let fullText = '';

    await readSSEStream(response, (data) => {
      try {
        const parsed = JSON.parse(data);
        const content = parsed.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
        if (content) {
          fullText += content;
          chrome.tabs.sendMessage(tabId, {
            action: "updatePrompt",
            text: fullText
          });
        }
      } catch (e) {
        console.warn('[Miampic] Gemini stream parse skipped:', e.message);
      }
    });

    // 完成
    const result = parseResponse(fullText);
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: true, result },
      mode: mode || 'generate',
      aspectRatio: aspectRatio || '9:16'
    });

    saveToHistory(result, mode, aspectRatio || '9:16');
  } catch (error) {
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: false, error: error.message || 'API 调用失败' }
    });
  }
}

// OpenAI 兼容 API 调用（硅基流动等）
async function analyzeWithOpenAI(base64, mediaType, systemPrompt, userText, providerConfig, apiKey, model, tabId, mode, language, aspectRatio) {
  // 确保 base64 数据干净
  const cleanBase64 = base64.replace(/\s/g, '');
  
  console.log('[Miampic] OpenAI API call, base64 length:', cleanBase64.length, 'mediaType:', mediaType);
  
  const imageUrl = `data:${mediaType};base64,${cleanBase64}`;
  console.log('[Miampic] Image URL prefix:', imageUrl.substring(0, 50) + '...');
  
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: imageUrl
          }
        },
        {
          type: 'text',
          text: userText
        }
      ]
    }
  ];

  try {
    const requestBody = {
      model: model || providerConfig.visionModels[0],
      messages: messages,
      max_tokens: 2048,
      temperature: 0.7,
      stream: true
    };
    
    console.log('[Miampic] Sending request to:', providerConfig.baseUrl);
    
    const response = await fetch(providerConfig.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      let errorMsg = `API 错误 (${response.status})`;
      try {
        const errData = JSON.parse(errText);
        errorMsg = errData.error?.message || errData.message || errorMsg;
      } catch (e) {
        errorMsg = errText || errorMsg;
      }
      chrome.tabs.sendMessage(tabId, {
        action: "showResult",
        result: { success: false, error: errorMsg }
      });
      return;
    }

    // 流式读取
    let fullText = '';

    await readSSEStream(response, (data) => {
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          chrome.tabs.sendMessage(tabId, {
            action: "updatePrompt",
            text: fullText
          });
        }
      } catch (e) {
        console.warn('[Miampic] OpenAI stream parse skipped:', e.message);
      }
    });

    // 完成
    const result = parseResponse(fullText, language || 'zh');
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: true, result },
      mode: mode || 'generate',
      aspectRatio: aspectRatio || '9:16'
    });

    saveToHistory(result, mode, aspectRatio || '9:16');
  } catch (error) {
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: false, error: error.message || 'API 调用失败' }
    });
  }
}

// 构建系统提示词
function buildSystemPrompt(language, mode, aspectRatio = '9:16') {
  const lang = language === 'zh' ? '中文' : 'English';
  const ratio = normalizeAspectRatio(aspectRatio);
  
  if (mode === 'assist') {
    // 辅助改图模式
    return `你是一位专业的 AI 生图提示词工程师。用户会提供一张参考图片，他们希望将自己的照片融入这张参考图的风格中。请你生成一段适合「图生图」场景的提示词，帮助用户把自己的照片改成参考图的风格。

分析维度（必须涵盖）：
- 整体风格：艺术风格、滤镜感、画面质感
- 色彩处理：色调倾向、调色风格、冷暖对比
- 光线氛围：光源方向、光线柔硬、氛围感
- 背景环境：场景类型、背景虚化程度、环境元素
- 人物呈现：姿态风格、服装风格、妆造感觉（如有）
- 后期质感：胶片/数码/HDR/朦胧/锐利等
- 画幅比例：必须固定为 ${ratio} 画幅比例，不允许使用其他比例

输出要求：
1. 使用 ${lang} 输出提示词
2. 用流畅自然的语言完整描述风格与氛围，将所有分析维度融入一段连贯的文字中，不要分点罗列
3. 重点描述风格、氛围、色调，不描述参考图中具体人物的脸部特征
4. 提示词中必须明确包含「${ratio} 画幅比例」或「${ratio} aspect ratio」的尺寸要求
5. 不要添加任何解释说明，只输出提示词本身`;
  } else {
    // 直接生图模式
    return `你是一位专业的 AI 生图提示词工程师。用户会提供一张图片，请你分析图片并生成一段高质量的生图提示词。

分析维度（必须涵盖）：
- 画面主体：主要对象、人物/动物/物体/场景
- 风格类型：写实/插画/油画/水彩/赛博朋克/日系/欧美/极简等
- 构图方式：中心构图/三分法/对称/留白/俯视/仰视/特写等
- 色调氛围：主色调、饱和度、明暗对比、冷暖感
- 光线效果：自然光/柔光/逆光/黄金时段/工作室灯光等
- 画面质感：清晰度、颗粒感、胶片感、HDR等
- 人物呈现：姿态风格、服装风格、妆造感觉（如有）
- 画幅比例：必须固定为 ${ratio} 画幅比例，不允许使用其他比例

输出要求：
1. 使用 ${lang} 输出提示词
2. 用流畅自然的语言完整描述画面，将所有分析维度融入一段连贯的文字中，不要分点罗列
3. 提示词中必须明确包含「${ratio} 画幅比例」或「${ratio} aspect ratio」的尺寸要求
4. 不要添加任何解释说明，只输出提示词本身`;
  }
}

// 解析响应 - 简化版本，直接返回文本
function parseResponse(text, language) {
  // 尝试提取 JSON 中的 prompt 字段（兼容旧格式）
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.prompt) {
        return {
          prompt: parsed.prompt
        };
      }
    }
  } catch (e) {
    // JSON 解析失败，使用原始文本
  }

  // 清理可能的 HTML 标签
  let cleanText = text
    .replace(/<[^>]*>/g, '') // 移除 HTML 标签
    .replace(/```[\s\S]*?```/g, '') // 移除代码块
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 移除 Markdown 加粗
    .trim();

  return {
    prompt: cleanText
  };
}

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeImage") {
    // 非流式分析（用于上传图片等场景）
    analyzeImageNonStream(request.imageData, request.settings, sender.tab?.id)
      .then(result => {
        saveToHistory(result, request.settings?.mode, request.settings?.aspectRatio || '9:16');
        sendResponse({ success: true, result });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "analyzeImageFromPopup") {
    // 从 popup 发来的分析请求（带 tabId）
    const tabId = request.tabId;
    
    // 先显示加载状态
    chrome.tabs.sendMessage(tabId, { action: "showLoading", mode: request.settings?.mode || 'generate', aspectRatio: request.settings?.aspectRatio || '9:16' });
    
    // 流式分析
    analyzeImageStream(request.imageData, request.settings, tabId);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "analyzeImageStream") {
    // 流式分析
    analyzeImageStream(request.imageData, request.settings, request.tabId || sender.tab?.id);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "captureTab") {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      cropImage(dataUrl, request.area).then(croppedBase64 => {
        sendResponse({ 
          success: true, 
          imageData: { base64: croppedBase64, mediaType: 'image/png' }
        });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    });
    return true;
  }

  if (request.action === "translatePrompt") {
    translatePrompt(request.prompt, request.settings)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// 非流式分析（备用）
async function analyzeImageNonStream(imageData, settings, tabId) {
  const { base64, mediaType } = imageData;
  const { provider, apiKey, model, language, mode, aspectRatio } = settings;

  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error('未知的 API 提供商');
  }

  const systemPrompt = buildSystemPrompt(language || 'zh', mode || 'generate', aspectRatio || '9:16');
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mediaType};base64,${base64}`
          }
        },
        {
          type: 'text',
          text: language === 'zh' 
            ? '请分析这张图片，生成图像生成提示词。' 
            : 'Analyze this image and generate an image generation prompt.'
        }
      ]
    }
  ];

  const response = await fetch(providerConfig.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || providerConfig.visionModels[0],
      messages: messages,
      max_tokens: 2048,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    let errorMsg = `API 错误 (${response.status})`;
    try {
      const errData = JSON.parse(errText);
      errorMsg = errData.error?.message || errData.message || errorMsg;
    } catch (e) {
      errorMsg = errText || errorMsg;
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseResponse(text, language || 'zh');
}

async function readApiError(response, fallback) {
  const text = await response.text().catch(() => '');
  if (!text) return fallback;

  try {
    const data = JSON.parse(text);
    return data.error?.message || data.message || fallback;
  } catch (e) {
    return text || fallback;
  }
}

// 翻译提示词
async function translatePrompt(prompt, settings) {
  const { provider, apiKey, model } = settings;
  const providerConfig = API_PROVIDERS[provider];

  if (!providerConfig) {
    throw new Error('未知的 API 提供商');
  }

  const selectedModel = model || providerConfig.visionModels[0];

  if (providerConfig.type === 'gemini') {
    return translatePromptWithGemini(prompt, apiKey, selectedModel);
  }

  return translatePromptWithOpenAI(prompt, providerConfig, apiKey, selectedModel);
}

async function translatePromptWithOpenAI(prompt, providerConfig, apiKey, model) {
  const response = await fetch(providerConfig.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a professional translator. Translate the following image prompt to English. Only output the translated text, nothing else.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1024,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, `翻译失败: ${response.status}`));
  }

  const data = await response.json();
  return (data.choices?.[0]?.message?.content || prompt).trim();
}

async function translatePromptWithGemini(prompt, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `Translate the following image prompt to English. Only output the translated text, nothing else.\n\n${prompt}`
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024
      }
    })
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, `翻译失败: ${response.status}`));
  }

  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || prompt).trim();
}

// 裁剪图片
async function cropImage(dataUrl, area) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);

  const dpr = area.devicePixelRatio || 1;
  const canvas = new OffscreenCanvas(
    Math.round(area.w * dpr),
    Math.round(area.h * dpr)
  );
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    imageBitmap,
    Math.round(area.x * dpr),
    Math.round(area.y * dpr),
    Math.round(area.w * dpr),
    Math.round(area.h * dpr),
    0, 0,
    Math.round(area.w * dpr),
    Math.round(area.h * dpr)
  );

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(croppedBlob);
  });
}

// 保存到历史记录
function saveToHistory(result, mode, aspectRatio = '9:16') {
  if (!result || !result.prompt) return;
  
  chrome.storage.local.get(['promptHistory'], (data) => {
    const history = data.promptHistory || [];
    
    history.push({
      prompt: result.prompt,
      mode: mode || 'generate',
      aspectRatio: normalizeAspectRatio(aspectRatio),
      timestamp: Date.now()
    });
    
    if (history.length > 100) {
      history.shift();
    }
    
    chrome.storage.local.set({ promptHistory: history });
  });
}




