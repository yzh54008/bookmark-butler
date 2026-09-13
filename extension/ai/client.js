/**
 * ai/client.js — OpenAI 兼容 Chat 客户端
 *
 * 只做四件事：拼请求、发请求、把回复里的 JSON 抠出来、把错误翻译成人话。
 * 重试策略：429 / 5xx / 网络抖动 指数退避重试；4xx（除 429）直接失败并给出可操作提示。
 */

/** 粗略 token 估算：中日韩字符按 1 token，其余按 4 字符 1 token。够用来做成本预警。 */
export function estimateTokens(text) {
  const s = String(text || '');
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk + other / 4);
}

export function estimateCost(usage, pricePerMTok) {
  if (!usage) return 0;
  const p = pricePerMTok || { in: 0, out: 0 };
  return (usage.prompt_tokens / 1e6) * (p.in || 0) + (usage.completion_tokens / 1e6) * (p.out || 0);
}

/** HTTP 状态码 / 网络异常 → 用户能看懂并知道怎么办的提示 */
export function friendlyError(status, body, baseUrl, model) {
  const snippet = String(body || '').slice(0, 300);
  if (status === 401 || status === 403) {
    return `鉴权失败（HTTP ${status}）：API Key 不正确、已过期，或没有该模型的权限。请到「模型配置」重新粘贴 Key。`;
  }
  if (status === 402) return `余额不足（HTTP 402）：请到服务商后台充值后再试。`;
  if (status === 404) {
    return `接口或模型不存在（HTTP 404）：请检查 Base URL 是否填对（要含 /v1），以及模型名「${model}」是否被该服务商支持。当前端点：${baseUrl}`;
  }
  if (status === 429) return `触发限流（HTTP 429）：请求太频繁或额度用尽。可把「并发数」调到 1，稍后重试。`;
  if (status === 400) return `请求被拒绝（HTTP 400）：多半是模型名不对或该模型不支持 JSON 输出。${snippet ? '详情：' + snippet : ''}`;
  if (status >= 500) return `服务商暂时故障（HTTP ${status}），已自动重试仍未成功，请稍后再试。`;
  return `请求失败（HTTP ${status}）：${snippet}`;
}

/**
 * 从模型回复里抠出 JSON。
 * 模型经常包 ```json 围栏、加客套话、或在中途截断，这里逐层兜底。
 */
export function extractJson(text) {
  let s = String(text || '').trim();
  if (!s) throw new Error('模型返回为空');

  // 1) 直接就是 JSON
  try { return JSON.parse(s); } catch { /* 继续 */ }

  // 2) 去 Markdown 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const inner = fence[1].trim();
    try { return JSON.parse(inner); } catch { s = inner; }
  }

  // 3) 取第一个平衡的 {...} 或 [...]
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = s.indexOf(open);
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const cand = s.slice(start, i + 1);
          try { return JSON.parse(cand); } catch { break; }
        }
      }
    }
  }

  // 4) 截断补救：补上缺失的收尾符号再试
  const repaired = repairTruncatedJson(s);
  if (repaired) return repaired;

  throw new Error('模型没有返回可解析的 JSON。可尝试降低「批量条数」或改用支持 JSON 模式的模型。');
}

/** 尝试修复被 max_tokens 截断的 JSON */
export function repairTruncatedJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let s = text.slice(start);
  // 砍掉最后一个不完整的成员
  s = s.replace(/,\s*"[^"]*"?\s*:?\s*[^,{}\[\]]*$/, '');
  s = s.replace(/,\s*$/, '');
  const opens = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') opens.push(ch);
    else if (ch === '}' || ch === ']') opens.pop();
  }
  let out = s;
  if (inStr) out += '"';
  while (opens.length) {
    const o = opens.pop();
    out += o === '{' ? '}' : ']';
  }
  try { return JSON.parse(out); } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 发起一次对话。
 * @param {object} cfg 已 resolve 的配置 {baseUrl, model, apiKey, temperature, maxTokens, jsonMode}
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} opts {signal, retries, jsonObject, onAttempt}
 */
export async function chat(cfg, messages, opts = {}) {
  const { baseUrl, model, apiKey } = cfg;
  const url = String(baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const retries = opts.retries ?? 3;
  const body = {
    model,
    messages,
    temperature: cfg.temperature ?? 0.2,
    max_tokens: cfg.maxTokens ?? 4096,
    stream: false,
  };
  // JSON 模式：不同服务商字段名不同
  if (opts.jsonObject) {
    if (cfg.jsonMode === 'response_format') body.response_format = { type: 'json_object' };
    else if (cfg.jsonMode === 'format') body.format = 'json';
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (attempt > 0) {
      const wait = Math.min(8000, 600 * 2 ** (attempt - 1));
      if (opts.onAttempt) opts.onAttempt({ attempt, wait });
      await sleep(wait);
    }
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey || 'ollama'}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        // 4xx（除 429）不值得重试
        if (res.status !== 429 && res.status < 500 && res.status !== 408) {
          throw Object.assign(new Error(friendlyError(res.status, txt, baseUrl, model)), {
            fatal: true, status: res.status,
          });
        }
        lastErr = new Error(friendlyError(res.status, txt, baseUrl, model));
        continue;
      }

      const data = await res.json();
      const choice = (data.choices || [])[0] || {};
      const text =
        choice.message?.content ??
        choice.text ??
        '';
      const usage = data.usage || null;
      return { text, usage, model: data.model || model, raw: data };
    } catch (e) {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError');
      if (e.fatal) throw e;
      if (e.name === 'AbortError') {
        lastErr = new Error('请求超时（120 秒）。可减少批量条数，或换更快的模型。');
      } else if (e instanceof TypeError) {
        lastErr = new Error(
          `无法连接到 ${baseUrl}。请检查：① Base URL 是否正确 ② 网络/代理是否可达 ` +
          `③ 是否已授权该域名（首次使用自定义端点时会弹权限确认）`
        );
      } else {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error('请求失败');
}

/** 单轮便捷调用，要求返回 JSON */
export async function chatJson(cfg, messages, opts = {}) {
  const r = await chat(cfg, messages, { ...opts, jsonObject: true });
  return { data: extractJson(r.text), usage: r.usage, text: r.text };
}

/** 测试连接：先试 /models，不行再退化为一次极小的对话请求 */
export async function testConnection(cfg, opts = {}) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(base + '/models', {
      headers: { Authorization: `Bearer ${cfg.apiKey || 'ollama'}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const d = await res.json().catch(() => null);
      const list = (d?.data || []).map((m) => m.id).filter(Boolean);
      return { ok: true, via: 'models', models: list, ms: Date.now() - t0 };
    }
    if (res.status !== 404) {
      const txt = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: friendlyError(res.status, txt, cfg.baseUrl, cfg.model) };
      }
    }
  } catch { /* 落到下面的对话探测 */ }

  try {
    const r = await chat(cfg, [
      { role: 'system', content: '你是连通性测试助手。' },
      { role: 'user', content: '只回复两个字：可用' },
    ], { retries: 0, timeoutMs: 30000, ...opts });
    return { ok: true, via: 'chat', sample: (r.text || '').slice(0, 30), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
