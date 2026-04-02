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
    const settings = await chrome.storage.sync.get(['apiKey', 'provider', 'model', 'language', 'mode']);
    if (!settings.apiKey) {
      chrome.tabs.sendMessage(tab.id, {
        action: "showError",
        error: '请先配置 API Key。点击扩展图标进行设置。'
      });
      return;
    }
    
    // 显示加载状态
    chrome.tabs.sendMessage(tab.id, { action: "showLoading", mode: settings.mode || 'generate' });
    
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
  const { provider, apiKey, model, language, mode } = settings;

  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig) {
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: false, error: '未知的 API 提供商' }
    });
    return;
  }

  const systemPrompt = buildSystemPrompt(language || 'zh', mode || 'generate');
  const userText = language === 'zh' 
    ? '请分析这张图片，生成图像生成提示词。' 
    : 'Analyze this image and generate an image generation prompt.';

  // 根据提供商类型选择不同的 API 格式
  if (providerConfig.type === 'gemini') {
    await analyzeWithGemini(base64, mediaType, systemPrompt, userText, apiKey, model || providerConfig.visionModels[0], tabId, mode);
  } else {
    await analyzeWithOpenAI(base64, mediaType, systemPrompt, userText, providerConfig, apiKey, model, tabId, mode, language);
  }
}

// Gemini API 调用
async function analyzeWithGemini(base64, mediaType, systemPrompt, userText, apiKey, model, tabId, mode) {
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
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (!data || data === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (content) {
              fullText += content;
              chrome.tabs.sendMessage(tabId, {
                action: "updatePrompt",
                text: fullText
              });
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    // 完成
    const result = parseResponse(fullText);
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: true, result },
      mode: mode || 'generate'
    });

    saveToHistory(result, mode);
  } catch (error) {
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: false, error: error.message || 'API 调用失败' }
    });
  }
}

// OpenAI 兼容 API 调用（硅基流动等）
async function analyzeWithOpenAI(base64, mediaType, systemPrompt, userText, providerConfig, apiKey, model, tabId, mode, language) {
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
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
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
            // 忽略解析错误
          }
        }
      }
    }

    // 完成
    const result = parseResponse(fullText, language || 'zh');
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: true, result },
      mode: mode || 'generate'
    });

    saveToHistory(result, mode);
  } catch (error) {
    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: { success: false, error: error.message || 'API 调用失败' }
    });
  }
}

// 构建系统提示词
function buildSystemPrompt(language, mode) {
  if (mode === 'assist') {
    // 辅助改图模式 - 更详细的描述，用于修改其他图片
    if (language === 'zh') {
      return `你是一个专业的图像分析助手，帮助用户生成用于辅助修改其他图片的详细提示词。

请仔细分析用户提供的参考图片，提取关键要素，生成一段详细的图像生成提示词，这个提示词将用于指导AI修改另一张图片。

重点分析并描述：
1. **主体特征**：人物/物体的外观、姿态、表情、服装细节、配饰等
2. **画面构图**：镜头角度、景别、透视关系、主体位置
3. **光影效果**：光源方向、光线质感、阴影分布、高光位置
4. **色彩风格**：主色调、配色方案、色彩氛围
5. **画面风格**：摄影风格、绘画风格、艺术流派
6. **环境背景**：场景描述、环境氛围、背景细节
7. **技术参数**：适合的画面比例、焦段建议、渲染方式

输出要求：
- 直接输出纯文本提示词，不要使用任何HTML标签、Markdown格式或JSON格式
- 使用逗号分隔的关键词形式
- 包含正向描述和可调整的参数建议
- 如果参考图有特殊细节（如服装款式、发型、妆容），请详细描述
- 提示词应该足够详细，让AI能够准确理解如何修改目标图片
- 包含图片比例建议（如 16:9, 4:3, 1:1 等）`;
    } else {
      return `You are a professional image analysis assistant that helps users generate detailed prompts for assisting in modifying other images.

Please carefully analyze the provided reference image, extract key elements, and generate a detailed image generation prompt that will be used to guide AI in modifying another image.

Focus on analyzing and describing:
1. **Subject Features**: Appearance, pose, expression, clothing details, accessories, etc.
2. **Composition**: Camera angle, shot size, perspective, subject position
3. **Lighting**: Light direction, light quality, shadow distribution, highlight positions
4. **Color Style**: Main tones, color scheme, color atmosphere
5. **Visual Style**: Photography style, painting style, art movement
6. **Environment**: Scene description, atmosphere, background details
7. **Technical Parameters**: Suitable aspect ratio, focal length suggestions, rendering method

Output requirements:
- Directly output plain text prompt, do not use any HTML tags, Markdown format or JSON format
- Use comma-separated keyword format
- Include positive descriptions and adjustable parameter suggestions
- If the reference image has special details (clothing style, hairstyle, makeup), describe them in detail
- The prompt should be detailed enough for AI to accurately understand how to modify the target image
- Include aspect ratio suggestions (e.g., 16:9, 4:3, 1:1)`;
    }
  } else {
    // 直接生图模式 - 标准的生图提示词
    if (language === 'zh') {
      return `你是一个专业的图像分析助手，帮助用户生成高质量的图像生成提示词。

请分析用户提供的图片，生成一段详细的图像生成提示词。

分析要点：
1. **主体描述**：人物/物体的外观、姿态、表情、服装、配饰等
2. **画面构图**：镜头角度、景别（特写/中景/全景）、透视关系、主体位置
3. **光影效果**：光源方向、光线质感、阴影分布
4. **色彩风格**：主色调、配色方案、色彩氛围
5. **画面风格**：摄影风格、绘画风格、艺术流派、渲染方式
6. **环境背景**：场景描述、环境氛围
7. **图片比例**：根据画面内容推荐合适的比例（如 16:9, 4:3, 1:1, 9:16, 3:4 等）

输出要求：
- 直接输出纯文本提示词，不要使用JSON格式、HTML标签或Markdown格式
- 使用逗号分隔的关键词形式
- 格式：主体描述, 构图参数, 光影描述, 风格关键词, 技术参数, 氛围词, 图片比例
- 确保提示词完整且专业，可直接用于AI生图`;
    } else {
      return `You are a professional image analysis assistant that helps users generate high-quality image prompts.

Analyze the provided image and generate a detailed image generation prompt.

Analysis points:
1. **Subject Description**: Appearance, pose, expression, clothing, accessories, etc.
2. **Composition**: Camera angle, shot size (close-up/medium/wide), perspective, subject position
3. **Lighting**: Light direction, light quality, shadow distribution
4. **Color Style**: Main tones, color scheme, color atmosphere
5. **Visual Style**: Photography style, painting style, art movement, rendering method
6. **Environment**: Scene description, atmosphere
7. **Aspect Ratio**: Recommend suitable ratio based on content (e.g., 16:9, 4:3, 1:1, 9:16, 3:4)

Output requirements:
- Directly output plain text prompt, do not use JSON format, HTML tags or Markdown format
- Use comma-separated keyword format
- Format: Subject description, composition parameters, lighting description, style keywords, technical parameters, atmosphere keywords, aspect ratio
- Ensure the prompt is complete and professional, ready for AI image generation`;
    }
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
        saveToHistory(result, request.settings?.mode);
        sendResponse({ success: true, result });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "analyzeImageFromPopup") {
    // 从 popup 发来的分析请求（带 tabId）
    const tabId = request.tabId;
    
    // 先显示加载状态
    chrome.tabs.sendMessage(tabId, { action: "showLoading" });
    
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
  const { provider, apiKey, model, language, mode } = settings;

  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error('未知的 API 提供商');
  }

  const systemPrompt = buildSystemPrompt(language || 'zh', mode || 'generate');
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

// 翻译提示词
async function translatePrompt(prompt, settings) {
  const { provider, apiKey, model } = settings;
  
  const providerConfig = API_PROVIDERS[provider];
  
  const response = await fetch(providerConfig.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || providerConfig.visionModels[0],
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
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `翻译失败: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || prompt;
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
function saveToHistory(result, mode) {
  if (!result || !result.prompt) return;
  
  chrome.storage.local.get(['promptHistory'], (data) => {
    const history = data.promptHistory || [];
    
    history.push({
      prompt: result.prompt,
      mode: mode || 'generate',
      timestamp: Date.now()
    });
    
    if (history.length > 100) {
      history.shift();
    }
    
    chrome.storage.local.set({ promptHistory: history });
  });
}
