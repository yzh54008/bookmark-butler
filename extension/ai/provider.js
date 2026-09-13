/**
 * ai/provider.js — 大模型服务商预设与终端适配
 *
 * 设计目标：任何人拿到这个插件，填自己的 Key 就能用。
 * 因此不写死任何一家的实现，而是统一走 OpenAI 兼容协议（/chat/completions），
 * 再用「预设」把各家差异（Base URL、默认模型、JSON 模式字段名、鉴权头）收敛掉。
 */

/** 服务商预设。baseUrl 一律写到 /v1 这一层，客户端再拼 /chat/completions */
export const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek（深度求索）',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    jsonMode: 'response_format',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk- 开头',
    note: '性价比高，中文分类归纳效果好。deepseek-chat 即可，不必用 reasoner（更贵更慢）。',
    pricePerMTok: { in: 2, out: 8 }, // 元 / 百万 token（用于成本预估，仅示意）
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    defaultModel: 'gpt-4o-mini',
    jsonMode: 'response_format',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk- 开头',
    note: '如果网络访问困难，可改填中转站的 Base URL。',
    pricePerMTok: { in: 1.1, out: 4.4 },
  },
  moonshot: {
    label: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0905-preview'],
    defaultModel: 'moonshot-v1-32k',
    jsonMode: 'response_format',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyHint: 'sk- 开头',
    note: '上下文大，长书签列表友好。',
    pricePerMTok: { in: 12, out: 12 },
  },
  qwen: {
    label: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    defaultModel: 'qwen-plus',
    jsonMode: 'response_format',
    keyUrl: 'https://bailian.console.aliyun.com/',
    keyHint: 'sk- 开头',
    note: '必须用「兼容模式」这个 Base URL，用错会 404。',
    pricePerMTok: { in: 0.8, out: 2 },
  },
  zhipu: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    defaultModel: 'glm-4-flash',
    jsonMode: 'response_format',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyHint: '形如 xxxx.xxxx',
    note: 'glm-4-flash 免费额度大，适合先试效果。',
    pricePerMTok: { in: 0, out: 0 },
  },
  siliconflow: {
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct'],
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    jsonMode: 'response_format',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    keyHint: 'sk- 开头',
    note: '聚合了多家开源模型，常有免费额度。',
    pricePerMTok: { in: 0, out: 0 },
  },
  openrouter: {
    label: 'OpenRouter（聚合）',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['deepseek/deepseek-chat', 'openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku'],
    defaultModel: 'deepseek/deepseek-chat',
    jsonMode: 'response_format',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or- 开头',
    note: '一个 Key 用多家模型，方便比效果。',
    pricePerMTok: { in: 1, out: 3 },
  },
  ollama: {
    label: '本地 Ollama（数据不出本机）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'],
    defaultModel: 'qwen2.5:7b',
    jsonMode: 'format',
    keyUrl: 'https://ollama.com/download',
    keyHint: '本地部署无需 Key，随便填（如 ollama）',
    note: '书签数据完全不出本机。需先 ollama pull 一个模型；小模型分类质量一般，建议 7B 以上。',
    pricePerMTok: { in: 0, out: 0 },
  },
  custom: {
    label: '自定义（OpenAI 兼容端点）',
    baseUrl: '',
    models: [],
    defaultModel: '',
    jsonMode: 'response_format',
    keyUrl: '',
    keyHint: '按你的服务商要求填写',
    note: '只要对方兼容 /v1/chat/completions 就能用。Base URL 填到 /v1 结尾。',
    pricePerMTok: { in: 0, out: 0 },
  },
};

export const DEFAULT_PROVIDER = 'deepseek';

/** 各项能力的开关：某些兼容端点不支持 response_format，允许降级 */
export const JSON_MODE = {
  RESPONSE_FORMAT: 'response_format',
  FORMAT: 'format',
  NONE: 'none',
};

export function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
}

/** 把 baseUrl 规范成不带尾斜杠，并补上 /chat/completions */
export function endpointOf(baseUrl) {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  return b + '/chat/completions';
}

/** 取 origin 用于申请权限，如 https://api.deepseek.com */
export function originOf(baseUrl) {
  try {
    const u = new URL(String(baseUrl || '').trim());
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return '';
  }
}

export function modelsEndpointOf(baseUrl) {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  // 部分服务商（如百炼兼容模式）不带 /v1，列模型接口在 /models
  return b + '/models';
}

/**
 * 校验 Base URL 是否是 http(s)。
 * 允许 http 只为支持本地 Ollama，其他明文端点会给用户提示。
 */
export function validateBaseUrl(baseUrl) {
  let u;
  try {
    u = new URL(String(baseUrl || '').trim());
  } catch {
    return { ok: false, error: 'Base URL 不是合法网址' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'Base URL 必须以 http:// 或 https:// 开头' };
  }
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(u.hostname);
  if (u.protocol === 'http:' && !isLocal) {
    return { ok: false, error: '除本地地址外，请使用 https://（否则密钥会明文传输）' };
  }
  return { ok: true, warning: isLocal ? '' : '' };
}

/**
 * 运行时申请该端点的访问权限（可选权限机制）。
 * 必须在用户点击事件中调用，否则 Chrome 会拒绝。
 */
export async function ensureOriginPermission(baseUrl) {
  const origin = originOf(baseUrl);
  if (!origin) return { granted: false, error: 'Base URL 无法解析' };
  try {
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return { granted: true };
  } catch {
    /* 忽略，继续走申请 */
  }
  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    return { granted: !!granted, origin };
  } catch (e) {
    return { granted: false, origin, error: String(e) };
  }
}
