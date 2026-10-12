export async function requestJson(path, options = {}) {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(path, { method: options.method || 'GET', credentials: 'same-origin', headers: options.body && !isForm ? { 'Content-Type': 'application/json' } : {}, body: options.body ? isForm ? options.body : JSON.stringify(options.body) : undefined, signal: options.signal || AbortSignal.timeout(15000) });
  const payload = await response.json();
  if (!response.ok) { const error = new Error(payload.error?.message || '请求未完成。'); error.code = payload.error?.code; error.status = response.status; throw error; }
  return payload;
}

export function createAgentRequester({ request, flush, getGeneration, timeoutMs = 120000 }) {
  return async function runAgent(path, payload, { signal, onRun } = {}) {
    const generation = getGeneration();
    const checkGeneration = () => {
      signal?.throwIfAborted();
      if (getGeneration() !== generation) { const error = new Error('资料已删除或更换，旧任务结果已忽略。'); error.code = 'PROFILE_CHANGED'; throw error; }
    };
    await flush(); checkGeneration();
    const accepted = await request(path, { method: 'POST', body: payload, signal });
    if (!accepted.run_id) { checkGeneration(); return accepted; }
    onRun?.(accepted.run_id);
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        checkGeneration();
        const run = await request(`/api/runs/${accepted.run_id}`, { signal });
        if (run.status === 'completed') { const result = await request(`/api/results/${run.result_ref}`, { signal }); checkGeneration(); return result; }
        if (['failed', 'blocked', 'cancelled', 'interrupted'].includes(run.status)) { const error = new Error(run.error?.message || '任务未完成。'); error.code = run.error?.code || run.status.toUpperCase(); throw error; }
        await new Promise((resolve, reject) => {
          const timer = setTimeout(done, 500);
          function done() { signal?.removeEventListener('abort', abort); resolve(); }
          function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); }
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
      }
      const error = new Error('处理超时，原文已保留，请先检查任务状态。'); error.code = 'AGENT_TIMEOUT'; throw error;
    } catch (error) {
      if (signal?.aborted || ['AGENT_TIMEOUT', 'PROFILE_CHANGED'].includes(error.code)) await request(`/api/runs/${accepted.run_id}/cancel`, { method: 'POST', body: {} }).catch(() => undefined);
      throw error;
    }
  };
}

export async function requestAgent(path, payload, options) {
  const {nativeBridge}=await import('./native-bridge.js');
  return nativeBridge().requestAgent(path,payload,options);
}
