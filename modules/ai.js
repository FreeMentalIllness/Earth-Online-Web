/* ===== 模块 ai.js（v16 模块化：window.EO 命名空间；AI 助手逻辑，运行时按需装载） ===== */
(function () {
  'use strict';
  var _g = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

  /** 拼装发给 AI 的系统上下文（用户真实数据摘要） */
  function buildAiContextSummary() {
    try {
      const stats = getLifeStats(state.birthDate);
      const profile = getProfile();
      const tasks = state.tasks || [];
      const done = tasks.filter(function (t) { return t.status === 'done'; });
      const pending = tasks.filter(function (t) { return t.status !== 'done'; });
      const todos = pending.filter(function (t) { return t.category === 'todo'; });
      const ach = (state.achievements || []).filter(function (a) { return a.unlocked; });
      const items = state.items || [];
      const memos = (state.memos || []).slice(-8);
      const L = [];

      L.push('你是「地球Online」这款人生记录应用内的助手。下面是这位用户的真实数据，请据此回答，不要编造。');
      L.push('');
      L.push('【角色】');
      L.push('- 名称：' + (profile.name || '未填写'));
      if (profile.signature) L.push('- 个性签名：' + profile.signature);
      L.push('- 等级：Lv.' + stats.age + (stats.hasBirth ? '（生日 ' + state.birthDate + '）' : '（未设置生日，等级为 0）'));

      L.push('');
      L.push('【任务】共 ' + tasks.length + ' 条：已完成 ' + done.length + ' 条，未完成 ' + pending.length + ' 条');
      if (todos.length) {
        L.push('- 待办 To Do：' + todos.slice(0, 15).map(function (t) {
          return t.title + (t.dueDate ? '（截止 ' + t.dueDate + '）' : '');
        }).join('；'));
      }
      const mainPending = pending.filter(function (t) { return t.category !== 'todo'; });
      if (mainPending.length) {
        L.push('- 进行中的任务：' + mainPending.slice(0, 15).map(function (t) {
          return t.title + '（' + Math.round(t.progress || 0) + '%）';
        }).join('；'));
      }

      L.push('');
      L.push('【背包】共 ' + items.length + ' 件');
      if (items.length) {
        L.push('- ' + items.slice(0, 12).map(function (i) { return i.name; }).join('、'));
      }

      L.push('');
      L.push('【成就】已解锁 ' + ach.length + ' 条');
      if (ach.length) {
        L.push('- ' + ach.slice(0, 12).map(function (a) { return a.title; }).join('、'));
      }

      L.push('');
      L.push('【收藏】共 ' + (state.collections || []).length + ' 条');

      if (memos.length) {
        L.push('');
        L.push('【最近的世界日志】');
        memos.forEach(function (m) {
          L.push('- ' + String(m.createdAt || '').slice(0, 10) + '：' + String(m.text || '').slice(0, 80));
        });
      }

      const today = todayStr();
      const calNote = (state.calendarNotes && state.calendarNotes[today]) ? state.calendarNotes[today] : '';
      if (calNote) {
        L.push('');
        L.push('【今天的随手记】' + calNote);
      }

      return L.join('\n');
    } catch (e) {
      // 取数据失败不该阻断提问 —— 没有上下文照样能聊
      return '';
    }
  }

  function renderAI() {
    const cfg = state.aiConfig || {};
    // v10：地址与模型一律留空，不预设默认值。
    // 预设值会让用户误以为"默认填好的就是官方推荐的"，而这类接口各家地址都不同。
    const baseUrl = cfg.baseUrl || '';
    const model = cfg.model || '';
    const configured = !!(cfg.baseUrl && cfg.apiKey);
    const convo = aiMessages.length
      ? aiMessages.map(function (m) {
          const isUser = m.role === 'user';
          const roleLabel = isUser ? '你' : '🤖 AI';
          return '<div class="ai-msg ' + (isUser ? 'ai-msg-user' : 'ai-msg-bot') + '">' +
            '<div class="ai-msg-role">' + escapeHtml(roleLabel) + '</div>' +
            '<div class="ai-msg-body">' + escapeHtml(m.content) + '</div>' +
          '</div>';
        }).join('')
      : '<div class="empty">还没有对话，向 AI 提个问题吧~</div>';

    document.getElementById('content').innerHTML =
      '<section class="page">' +
        '<div class="page-head"><h2 class="page-title">🤖 系统</h2></div>' +
        '<div class="card">' +
          '<div class="card-title">接口配置</div>' +
          '<div class="form-row"><label>API 地址</label>' +
            '<input id="aiBaseUrl" class="list-input" placeholder="接口根地址，照抄厂商文档里的 Base URL" value="' + escapeHtml(baseUrl) + '"></div>' +
          '<div class="form-row"><label>API Key</label>' +
            '<input id="aiApiKey" class="list-input" type="password" placeholder="粘贴你的 API Key" value="' + escapeHtml(cfg.apiKey || '') + '"></div>' +
          '<div class="form-row"><label>模型</label>' +
            '<input id="aiModel" class="list-input" placeholder="请填写模型名称，如 deepseek-chat" value="' + escapeHtml(model) + '"></div>' +
          '<p class="backup-note">提问时会把你的任务 / 背包 / 成就 / 日志等数据作为上下文一并发给该接口，' +
            '请确认你信任这个服务方。</p>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-primary" data-action="ai-save-config">保存配置</button>' +
          '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-title">对话</div>' +
          (configured ? '' : '<p class="backup-note">⚠️ 还未配置接口，发送前请先在上方填写 API 地址、密钥与模型。</p>') +
          '<div class="ai-convo" id="aiConvo">' + convo + '</div>' +
          '<div class="ai-input-row">' +
            '<textarea id="aiInput" class="list-textarea" placeholder="输入你的问题，回车发送（Shift+Enter 换行）"></textarea>' +
            '<div class="modal-actions">' +
              '<button class="btn btn-ghost btn-sm" data-action="ai-clear">清空对话</button>' +
              '<button class="btn btn-primary" data-action="ai-send">发送</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    // 对话滚动到底部
    const conv = document.getElementById('aiConvo');
    if (conv && typeof conv.scrollTo === 'function') {
      conv.scrollTop = conv.scrollHeight;
    }
  }

  /** 保存 AI 配置（写入 state.aiConfig 并持久化） */
  function saveAiConfig() {
    const cfg = state.aiConfig || (state.aiConfig = {});
    const bu = document.getElementById('aiBaseUrl');
    const ak = document.getElementById('aiApiKey');
    const md = document.getElementById('aiModel');
    const model = md ? md.value.trim() : '';
    // v15 修复：模型为必填项，留空不允许保存（避免带着空模型以为已配置）
    if (!model) { toast('请先填写模型名称'); return; }
    cfg.baseUrl = bu ? bu.value.trim() : '';
    cfg.apiKey = ak ? ak.value.trim() : '';
    // v10：模型也不再兜底默认值，留空就是留空
    cfg.model = model;
    saveState();
    toast('AI 配置已保存');
  }

  /** 发送提问到 DeepSeek 兼容端点（/chat/completions，Bearer 鉴权） */
  function handleAiSend() {
    const input = document.getElementById('aiInput');
    if (!input) return;
    const q = input.value.trim();
    if (!q) { toast('先输入点什么吧'); return; }
    const cfg = state.aiConfig || {};
    // v10：地址与密钥缺一不可。合成一条提示，用户不用猜到底少填了哪个
    if (!cfg.baseUrl || !cfg.apiKey) { toast('请先配置 API 地址和密钥'); return; }

    const baseUrl = String(cfg.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const model = cfg.model || '';
    // 模型为空时多数接口会直接报 "model is required"，与其让用户看一段英文报错，不如提前挡掉
    if (!model) { toast('请先填写模型名称'); return; }

    aiMessages.push({ role: 'user', content: q });
    aiMessages.push({ role: 'assistant', content: '🤖 思考中…' });
    const placeholderIdx = aiMessages.length - 1;
    renderAI();

    // 上下文摘要作为 system 消息置于最前。
    // 每轮实时生成、只发一份 —— 若塞进 aiMessages 会随对话轮次重复堆叠，白白烧 token。
    const sendMessages = [];
    const summary = buildAiContextSummary();
    if (summary) sendMessages.push({ role: 'system', content: summary });
    aiMessages.slice(0, placeholderIdx).forEach(function (m) {
      sendMessages.push({ role: m.role, content: m.content });
    });
    input.value = '';

    fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({ model: model, messages: sendMessages, stream: false }),
    })
      .then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (txt) {
            throw new Error('HTTP ' + resp.status + (txt ? '：' + txt.slice(0, 120) : ''));
          });
        }
        return resp.json();
      })
      .then(function (data) {
        const text = (data && data.choices && data.choices[ 0 ] && data.choices[ 0 ].message && data.choices[ 0 ].message.content) || '（AI 没有返回内容）';
        aiMessages[placeholderIdx] = { role: 'assistant', content: text };
        renderAI();
      })
      .catch(function (err) {
        aiMessages[placeholderIdx] = { role: 'assistant', content: '请求失败：' + (err && err.message ? err.message : ' 网络错误') };
        renderAI();
      });
  }

  /* ---- 导出到 EO.ai 并同步全局（兼容旧引用 / 测试桩） ---- */
  E.ai = {
    buildAiContextSummary: buildAiContextSummary,
    renderAI: renderAI,
    saveAiConfig: saveAiConfig,
    handleAiSend: handleAiSend,
  };
  ['buildAiContextSummary', 'renderAI', 'saveAiConfig', 'handleAiSend'].forEach(function (n) {
    try { if (typeof _g !== 'undefined' && typeof _g[n] === 'undefined') _g[n] = E.ai[n]; } catch (e) {}
  });
})();
