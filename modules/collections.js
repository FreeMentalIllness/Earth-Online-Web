/* ===== 模块 collections.js（v16 模块化：window.EO 命名空间） ===== */
var state = null;
var currentAccount = null;
var backpackTab = 'all';
(function () {
  'use strict';
  var _g = (typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

/**
 * collections.js —— 个人收藏（v2 新增，背包第三 tab）
 * 职责：收藏 tab 渲染（二级分类筛选 + P1 搜索 + 卡片网格）、新建/编辑/详情模态、
 * 会话级文件注册表 collectionFiles（blob 生命周期）、MIME 四路分发打开、刷新后重新关联。
 *
 * blob 生命周期约定（设计文档 §7.5）：
 *   - 唯一入口 attachCollectionFile / 唯一出口 detachCollectionFile（内部 revokeObjectURL）；
 *   - 删除/替换收藏附件的路径必须经过 detach，禁止直接操作 collectionFiles Map；
 *   - fileMeta 随存档持久化，二进制不持久化（刷新后「需重新关联」降级）；
 *   - 表单待选文件暂存 pendingFile（尚未 createObjectURL，取消即丢弃，无孤儿 blob）。
 *
 * 事件约定：data-action 的 case 集中在 pages.js；模态内按钮沿用 v1 先例直接
 * onclick 绑定；隐式 file input 由本模块自建并绑定 change。
 */

/* ---------- 页面级临时状态（不持久化） ---------- */

let collectionCatFilter = 'all';      // 收藏分类筛选（all | 某分类 | __none__ 未分类）
let collectionSearchKeyword = '';     // P1-3 搜索关键词（本地小数据量，不做防抖）
let pendingFile = null;               // 新建/编辑表单待选文件（尚未生成 blob）
let pendingRelinkId = null;           // 重新关联的目标收藏 id

/** 会话级文件注册表：collectionId → { file: File, blobUrl: string }（不持久化） */
const collectionFiles = new Map();

/* ==================== blob 注册表（唯一出入口） ==================== */

/**
 * 关联文件：校验非空；该 id 已有条目先 detach（释放旧 blob）；
 * URL.createObjectURL 后存入 Map。@returns {{ok, blobUrl?, error?}}
 */
function attachCollectionFile(id, file) {
  if (!id || !file) return { ok: false, blobUrl: null, error: '无效的收藏或文件' };
  if (collectionFiles.has(id)) detachCollectionFile(id);
  const blobUrl = URL.createObjectURL(file);
  collectionFiles.set(id, { file: file, blobUrl: blobUrl });
  return { ok: true, blobUrl: blobUrl, error: '' };
}

/** Map 命中返回 blobUrl，否则 null */
function getCollectionBlobUrl(id) {
  const rec = collectionFiles.get(id);
  return rec ? rec.blobUrl : null;
}

/** 会话内是否有活跃文件（区别于 entry.fileMeta：元数据在、二进制可能不在） */
function hasLiveFile(id) {
  return collectionFiles.has(id);
}

/** 唯一出口：revokeObjectURL + Map.delete（防内存泄漏） */
function detachCollectionFile(id) {
  const rec = collectionFiles.get(id);
  if (!rec) return;
  collectionFiles.delete(id);
  if (rec.blobUrl) URL.revokeObjectURL(rec.blobUrl);
}

/** 人性化文件大小展示 */
function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return n + ' B';
  const round = function (v) { return Math.round(v * 10) / 10; };
  const kb = n / 1024;
  if (kb < 1024) return round(kb) + ' KB';
  const mb = kb / 1024;
  if (mb < 1024) return round(mb) + ' MB';
  return round(mb / 1024) + ' GB';
}

/* ==================== 渲染 ==================== */

/** 收藏 tab 主体 HTML（由 pages.js renderBackpack 在 collection tab 下拼入）。
 *  v1.0.3 迭代：搜索框与分类栏已上移到 renderBackpack 统一渲染（与物品 Tab 同构同类名），
 *  本函数只负责卡片主体：网格 / 空状态。 */
function renderCollectionsTab() {
  const keyword = String(collectionSearchKeyword == null ? '' : collectionSearchKeyword);
  const all = searchCollections(keyword);
  const filtered = collectionCatFilter === 'all'
    ? all
    : (collectionCatFilter === '__none__'
        ? all.filter(function (c) { return !c.category; })
        : all.filter(function (c) { return c.category === collectionCatFilter; }));

  // v1.0.3 迭代 3：空状态统一走 emptyStateHtml（与物品 Tab 完全同款大引导卡）。
  // 注意跨文件通道：emptyStateHtml 定义在 pages.js（闭包私有），必须经导出对象 E 调用，
  // 直接 typeof 裸调在闭包内恒为 undefined（这正是此前收藏夹空状态退化成细提示条的原因）。
  function _empty(emoji, title, msg, btn) {
    if (typeof E !== 'undefined' && E && typeof E.emptyStateHtml === 'function') {
      return E.emptyStateHtml(emoji, title, msg, btn);
    }
    return '<div class="card empty">' + emoji + ' ' + escapeHtml(title) + '，' + btn + '</div>';
  }

  const bodyHtml = getCollectionCategoryList().length === 0
    // v1.0.3 迭代：无分类但有收藏时直接平铺展示全部收藏（此前被空状态盖住，收藏条目直接消失），
    // 顶部只放一条轻提示引导建分类 —— 引导与数据可见性两不误。
    ? (all.length
        ? '<div class="card empty category-empty">🏷️ 还没有分类，<button type="button" class="link-btn" data-action="collection-manage-categories">点此创建分类</button>归置更清爽；以下是全部收藏：</div>' +
          '<div class="collection-grid bp-grid">' + all.map(renderCollectionCard).join('') + '</div>'
        : _empty('🏷️', '还没有收藏分类',
            '收藏夹按分类归置更清爽：书籍、影视、文章、灵感……先建一个分类，再把想留住的收进来。',
            '<button class="btn btn-primary" data-action="collection-manage-categories">创建分类</button>'))
    : (filtered.length
        ? '<div class="collection-grid bp-grid">' + filtered.map(renderCollectionCard).join('') + '</div>'
        // v1.2.1：空状态引导（emoji 插画 + 说明 + 直达按钮）
        : (all.length
          ? '<div class="card empty">🔍 该分类下暂无收藏，换个分类看看~</div>'
          : _empty('📚', '收藏夹空着呢',
              '值得回看的东西都往这儿放：一篇好文章、一段聊天记录、一张截图，还能附上原文件。',
              '<button class="btn btn-primary" data-action="collection-new">+ 添加第一条收藏</button>')));

  return bodyHtml;
}

/** 把分类渲染成一枚徽章（未分类回落「未分类」） */
function renderCollectionCategory(entry) {
  const cat = entry.category || '';
  return '<span class="badge collection-cat-badge">' + (cat ? escapeHtml(cat) : '未分类') + '</span>';
}

/** 收藏卡片：图片类以 blob 缩略图为封面；fileMeta 在而二进制不在 → 「需重新关联」角标
 *  v1.0.3 迭代 3：骨架与物品卡（renderItemCard）完全同构 —— 顶部徽章+编辑/删除行、
 *  标题、备注、附件行、时间行，同类名同对齐；封面图仅在有图片附件时保留为顶部横幅，
 *  不再有 icon 大色块与底部操作行（此前与物品卡视觉不一致的根源）。 */
function renderCollectionCard(entry) {
  const live = hasLiveFile(entry.id);
  const blobUrl = live ? getCollectionBlobUrl(entry.id) : '';
  const isImage = entry.fileMeta && String(entry.fileMeta.mime).indexOf('image/') === 0;

  const cover = isImage && live
    ? '<img class="collection-cover" src="' + blobUrl + '" alt="' + escapeHtml(entry.title) + '">'
    : '';

  const relinkBadge = entry.fileMeta && !live
    ? '<button type="button" class="file-badge" data-action="collection-file-relink" data-id="' +
        entry.id + '" title="重新选择本地文件">📎 文件需重新关联</button>'
    : '';

  const fileLine = entry.fileMeta
    ? '<div class="muted collection-file">' + (live ? '📄 ' : '') + escapeHtml(entry.fileMeta.name) +
      '（' + formatFileSize(entry.fileMeta.size) + '）</div>'
    : '';

  return (
    '<div class="collection-card bp-card" data-action="collection-open" data-id="' + entry.id + '">' +
      relinkBadge +
      cover +
      '<div class="item-head">' +
        renderCollectionCategory(entry) +
        '<span class="task-actions">' +
          '<button class="icon-btn" data-action="collection-edit" data-id="' + entry.id + '">编辑</button>' +
          '<button class="icon-btn danger" data-action="collection-delete" data-id="' + entry.id + '">删除</button>' +
        '</span>' +
      '</div>' +
      '<div class="item-name">' + escapeHtml(entry.title) + '</div>' +
      (entry.note
        ? '<div class="item-desc">' + escapeHtml(entry.note) + '</div>'
        : '<div class="item-desc">—</div>') +
      fileLine +
      '<div class="muted item-date">收藏时间：' + escapeHtml(entry.createdAt) + '</div>' +
    '</div>'
  );
}

/* ==================== 模态 ==================== */

/** 新建 / 编辑收藏模态；分类为下拉选择 + 新建分类输入，附件暂存 pendingFile */
function openCollectionModal(entry) {
  pendingFile = null;
  const isEdit = !!entry;

  const cats = getCollectionCategoryList();
  const selCat = isEdit ? (entry.category || '') : (cats[0] || '');
  const catOptions = cats.length
    ? '<option value="">未分类</option>' + cats.map(function (c) {
        return '<option value="' + escapeHtml(c) + '"' + (c === selCat ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
      }).join('')
    : '<option value="" disabled selected>请先创建分类</option>';

  openModal(
    '<h3 class="modal-title">' + (isEdit ? '编辑收藏' : '新建收藏') + '</h3>' +
    '<div class="form-row"><label>标题</label><input id="cmTitle" maxlength="100" ' +
      'placeholder="收藏的名称（必填，如专辑名 / 电影名）" value="' + escapeHtml(isEdit ? entry.title : '') + '"></div>' +
    '<div class="form-row"><label>分类</label>' +
      '<select id="cmCategory">' + catOptions + '</select>' +
      '<input id="cmNewCat" class="list-input" style="margin-top:8px" maxlength="30" ' +
        'placeholder="或输入新分类名，保存时自动创建"></div>' +
    '<div class="form-row"><label>备注</label><textarea id="cmNote" maxlength="200" ' +
      'placeholder="想说的、为什么收藏它（可选）">' + escapeHtml(isEdit ? entry.note : '') + '</textarea></div>' +
    '<div class="form-row"><label>附件</label><div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="collection-file-attach">选择文件…</button> ' +
      '<span class="muted" id="cmFileName">' +
        (isEdit && entry.fileMeta ? escapeHtml(entry.fileMeta.name) : '未选择文件') + '</span>' +
      '<p class="muted">文件仅保存在本次会话中，刷新后可在卡片上「重新关联」恢复。</p>' +
    '</div></div>' +
    '<div class="modal-error" id="cmError"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="cmCancel">取消</button>' +
      '<button class="btn btn-primary" id="cmSave">' + (isEdit ? '保存修改' : '保存收藏') + '</button>' +
    '</div>'
  );

  document.getElementById('cmCancel').onclick = function () {
    pendingFile = null; // 取消即丢弃，尚未 createObjectURL，无需 revoke
    closeModal();
  };
  document.getElementById('cmSave').onclick = function () {
    handleCollectionSave(isEdit ? entry.id : null);
  };
}

/** 保存收藏：标题必填；分类取下拉值，若填了「新建分类」则以新分类为准（自动创建）；
 *  编辑未换文件时保留原 fileMeta；新文件保存成功后 attach */
function handleCollectionSave(editId) {
  const errEl = document.getElementById('cmError');
  const title = val('cmTitle').trim();
  const selCat = val('cmCategory');
  const newCat = val('cmNewCat').trim();
  const note = val('cmNote').trim();

  if (!title) {
    if (errEl) errEl.textContent = '标题不能为空';
    return;
  }

  // 无分类引导：新建且尚未创建任何分类时，拦截并打开分类管理
  if (!editId && getCollectionCategoryList().length === 0) {
    openCollectionCategoryManageModal();
    toast('请先创建分类');
    return;
  }

  // 分类优先级：新建分类名 > 下拉选择
  let category = newCat || selCat;
  if (newCat && (state.collectionCategories || []).indexOf(newCat) === -1) {
    const res = addCollectionCategory(newCat);
    if (!res.ok) { if (errEl) errEl.textContent = res.error; return; }
  }

  const fileMeta = pendingFile
    ? { name: pendingFile.name, mime: pendingFile.type, size: pendingFile.size }
    : null;

  let saved;
  if (editId) {
    const patch = { category: category, title: title, note: note };
    if (pendingFile) {
      detachCollectionFile(editId); // 替换附件前先释放旧 blob
      patch.fileMeta = fileMeta;
    }
    saved = updateCollection(editId, patch);
  } else {
    saved = addCollection({ category: category, title: title, note: note, fileMeta: fileMeta });
  }

  if (pendingFile && saved) attachCollectionFile(saved.id, pendingFile);
  pendingFile = null;

  closeModal();
  toast(editId ? '收藏已更新' : '「' + title + '」已加入收藏');
  checkAutoAchievements(); // collect_5 / collect_file_3 联动
  renderBackpack();
}

/** 收藏详情模态：文件信息 + 打开/播放 + 重新关联 + 编辑 + 删除 */
function openCollectionDetail(id) {
  const entry = getCollectionById(id);
  if (!entry) return;
  const live = hasLiveFile(id);
  const catHtml = renderCollectionCategory(entry);

  let fileHtml;
  if (entry.fileMeta) {
    fileHtml = '<div class="detail-item">📎 ' + escapeHtml(entry.fileMeta.name) +
      '（' + formatFileSize(entry.fileMeta.size) + '）' +
      (live ? '' : ' <span class="form-error">需重新关联后才能打开</span>') + '</div>';
  } else {
    fileHtml = '<div class="detail-item muted">未关联文件（纯文字收藏同样完整可用）</div>';
  }

  const openLabel = entry.fileMeta
    ? (live ? openActionLabel(entry.fileMeta.mime) : '重新关联文件')
    : '';

  openModal(
    '<h3 class="modal-title">' + escapeHtml(entry.title) + '</h3>' +
    '<p class="modal-text">' + catHtml + ' ' +
      (entry.note ? escapeHtml(entry.note) : '<span class="muted">无备注</span>') + '</p>' +
    fileHtml +
    '<div class="modal-actions">' +
      (entry.fileMeta ? '<button class="btn btn-primary" id="cdOpen">' + openLabel + '</button>' : '') +
      '<button class="btn btn-ghost" id="cdEdit">编辑</button>' +
      '<button class="btn btn-danger" id="cdDelete">删除</button>' +
      '<button class="btn btn-ghost" id="cdClose">关闭</button>' +
    '</div>'
  );

  const openBtn = document.getElementById('cdOpen');
  if (openBtn) {
    openBtn.onclick = function () {
      if (live) openCollectionFile(id);
      else triggerCollectionRelink(id);
    };
  }
  document.getElementById('cdEdit').onclick = function () { openCollectionModal(entry); };
  document.getElementById('cdDelete').onclick = function () { confirmDeleteCollection(id); };
  document.getElementById('cdClose').onclick = closeModal;
}

/** 删除确认（卡片按钮与详情模态共用；内部 detach revoke 由 deleteCollection 负责） */
function confirmDeleteCollection(id) {
  const entry = getCollectionById(id);
  if (!entry) return;
  openConfirm('确定删除收藏「' + entry.title + '」吗？附件将一并释放。', function () {
    deleteCollection(id); // 内部先 detachCollectionFile（revoke blob）再移除
    checkAutoAchievements();
    renderBackpack();
    toast('收藏已删除');
  });
}

/* ==================== 文件选择与重新关联 ==================== */

/** 新建/编辑表单的附件选择：
 *  复用首页持久化的隐藏 <input type="file" id="collectionFileInput">，直接触发其 click()，
 *  避免临时创建 input 在部分 WebView / iOS Safari 下无法弹窗的问题；accept 按当前类别限定类型。
 */
function triggerCollectionFileAttach() {
  const catSel = document.getElementById('cmCategory');
  const newCat = document.getElementById('cmNewCat');
  const cat = (newCat && newCat.value.trim()) || (catSel ? catSel.value : '');
  const input = document.getElementById('collectionFileInput');
  if (!input) return;
  try { input.setAttribute('accept', collectionAccept(cat)); } catch (e) { /* 忽略不支持的属性 */ }
  input.click();
}

/** 隐藏文件框的持久化 change 监听（脚本加载时绑定一次；输入框位于 index.html 的 body 内）。 */
(function bindCollectionFileInput() {
  const fi = document.getElementById('collectionFileInput');
  if (!fi || fi.__bound) return;
  fi.__bound = true;
  fi.addEventListener('change', function () {
    pendingFile = (fi.files && fi.files[0]) || null;
    const label = document.getElementById('cmFileName');
    if (label) {
      label.textContent = pendingFile
        ? pendingFile.name + '（' + formatFileSize(pendingFile.size) + '）'
        : '未选择文件';
    }
    fi.value = ''; // 清空，允许用户再次选择同一文件触发 change
  });
})();

/**
 * 刷新后重新关联：触发 file input；选中后名字一致则恢复（提示），
 * 名字不同也接受并覆盖 fileMeta（toast 提示「已按新文件更新」）。
 */
function triggerCollectionRelink(id) {
  pendingRelinkId = id;
  const input = document.createElement('input');
  input.type = 'file';
  input.addEventListener('change', function () {
    const file = (input.files && input.files[0]) || null;
    if (file) handleCollectionRelink(file);
  });
  input.click();
}

/** 重新关联落地：attach + 覆盖 fileMeta + 成就检测 + 刷新 */
function handleCollectionRelink(file) {
  const id = pendingRelinkId;
  pendingRelinkId = null;
  const entry = getCollectionById(id);
  if (!entry || !file) return;

  const oldName = entry.fileMeta ? entry.fileMeta.name : '';
  const result = attachCollectionFile(id, file);
  if (!result.ok) {
    toast(result.error);
    return;
  }
  updateCollection(id, { fileMeta: { name: file.name, mime: file.type, size: file.size } });
  toast(oldName && file.name !== oldName
    ? '已按新文件「' + file.name + '」更新关联信息'
    : '文件已重新关联');
  checkAutoAchievements();
  renderBackpack();
}

/* ==================== MIME 四路分发打开 ==================== */

/** 按文件名/类别推断打开按钮文案 */
function openActionLabel(mime) {
  const m = String(mime || '');
  if (m.indexOf('image/') === 0) return '查看图片';
  if (m.indexOf('audio/') === 0) return '播放音频';
  if (m.indexOf('video/') === 0) return '播放视频';
  return '打开文件';
}

/**
 * MIME 四路分发（设计文档 §3.4）：
 *   image/* → 模态 <img>；audio/* → <audio controls>；video/* → <video controls>；
 *   其他/未知 → 详情模态显示 name+size + 「用系统默认程序打开」按钮（window.open）。
 */
function openCollectionFile(id) {
  const entry = getCollectionById(id);
  if (!entry) return;

  if (!hasLiveFile(id)) {
    if (entry.fileMeta) toast('文件需重新关联后才能打开');
    else toast('该收藏未关联文件');
    return;
  }

  const blobUrl = getCollectionBlobUrl(id);
  const rec = collectionFiles.get(id);
  const mime = String((entry.fileMeta && entry.fileMeta.mime) || (rec && rec.file.type) || '');
  const name = entry.fileMeta ? entry.fileMeta.name : (rec ? rec.file.name : '');

  if (mime.indexOf('image/') === 0) {
    openModal(
      '<h3 class="modal-title">' + escapeHtml(entry.title) + '</h3>' +
      '<img class="file-preview-img" src="' + blobUrl + '" alt="' + escapeHtml(entry.title) + '">' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="fpClose">关闭</button></div>'
    );
  } else if (mime.indexOf('audio/') === 0) {
    openModal(
      '<h3 class="modal-title">' + escapeHtml(entry.title) + '</h3>' +
      '<audio class="file-preview-audio" controls src="' + blobUrl + '"></audio>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="fpClose">关闭</button></div>'
    );
  } else if (mime.indexOf('video/') === 0) {
    openModal(
      '<h3 class="modal-title">' + escapeHtml(entry.title) + '</h3>' +
      '<video class="file-preview-video" controls src="' + blobUrl + '"></video>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="fpClose">关闭</button></div>'
    );
  } else if (mime.indexOf('application/pdf') === 0 || /\.pdf$/i.test(name || '')) {
    // PDF：应用内嵌预览（iframe 直接渲染，无需下载）
    openModal(
      '<h3 class="modal-title">' + escapeHtml(entry.title) + '</h3>' +
      '<iframe class="file-preview-pdf" src="' + blobUrl + '" title="' + escapeHtml(entry.title) + '"></iframe>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-ghost" id="fpOpen">新窗口打开</button>' +
        '<button class="btn btn-ghost" id="fpClose">关闭</button>' +
      '</div>'
    );
    const openBtn2 = document.getElementById('fpOpen');
    if (openBtn2) openBtn2.onclick = function () { try { window.open(blobUrl, '_blank'); } catch (e) { toast('浏览器限制了此操作'); } };
  } else {
    // 其他/未知类型（含 .exe / .apk / 文档等）：网页沙箱无法「拉起系统应用」运行或安装，
    // 仅能交给浏览器下载 / 默认程序处理；exe/apk 会落到本地下载，由用户手动运行/安装。
    const size = entry.fileMeta ? entry.fileMeta.size : (rec ? rec.file.size : 0);
    const isExecutable = /\.(exe|apk|msi|dmg|deb|sh|bat)$/i.test(name || '');
    openModal(
      '<h3 class="modal-title">' + escapeHtml(entry.title) + '</h3>' +
      '<p class="modal-text">📎 ' + escapeHtml(name) + '（' + formatFileSize(size) + '）</p>' +
      (isExecutable
        ? '<p class="muted">这是可执行 / 安装包。网页环境无法自动运行或安装，点击后将下载到本地，由你在文件管理器中手动运行 / 安装。</p>'
        : '<p class="muted">该类型暂不支持应用内预览，可交给系统默认程序打开（被拦截时浏览器会自动下载）。</p>') +
      '<div class="modal-actions">' +
        '<button class="btn btn-primary" id="fpOpen">' + (isExecutable ? '⬇️ 下载到本地' : '用系统默认程序打开') + '</button>' +
        '<button class="btn btn-ghost" id="fpClose">关闭</button>' +
      '</div>'
    );
    const openBtn = document.getElementById('fpOpen');
    if (openBtn) {
      openBtn.onclick = function () {
        try {
          const w = window.open(blobUrl, '_blank');
          if (!w) toast('浏览器限制了此操作，文件已触发下载');
        } catch (e) {
          toast('浏览器限制了此操作，文件已触发下载');
        }
      };
    }
  }
  const closeBtn = document.getElementById('fpClose');
  if (closeBtn) closeBtn.onclick = closeModal;
}

/* ==================== 筛选 / 搜索（pages.js 分发调用） ==================== */

/** 分类筛选切换 */
function handleCollectionCategoryFilter(catKey) {
  collectionCatFilter = (catKey && typeof catKey === 'string') ? catKey : 'all';
  renderBackpack();
}

/* ==================== 收藏分类管理 ==================== */

/** 收藏分类管理模态：新增 / 重命名 / 删除 */
function openCollectionCategoryManageModal() {
  const cats = getCollectionCategoryList();
  const rows = cats.length
    ? cats.map(function (c) {
        return '<div class="list-row">' +
          '<span class="field-label">' + escapeHtml(c) + '</span>' +
          '<span class="task-actions">' +
            '<button class="icon-btn" data-action="collection-cat-rename" data-name="' + escapeHtml(c) + '">重命名</button>' +
            '<button class="icon-btn danger" data-action="collection-cat-delete" data-name="' + escapeHtml(c) + '">删除</button>' +
          '</span>' +
        '</div>';
      }).join('')
    : '<div class="empty">还没有自定义分类，在下方添加一个吧~</div>';
  openModal(
    '<h3 class="modal-title">收藏分类管理</h3>' +
    '<div class="form-row"><label>新分类</label><div style="display:flex;gap:8px">' +
      '<input id="newColCatName" placeholder="分类名称（如：漫画、播客）" maxlength="30">' +
      '<button class="btn btn-primary" id="colCatAdd">添加</button></div></div>' +
    '<div class="list-group">' + rows + '</div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="colCatClose">关闭</button></div>'
  );
  const closeBtn = document.getElementById('colCatClose');
  if (closeBtn) closeBtn.onclick = closeModal;
  const addBtn = document.getElementById('colCatAdd');
  if (addBtn) addBtn.onclick = function () {
    const res = addCollectionCategory(val('newColCatName').trim());
    if (!res.ok) { toast(res.error); return; }
    openCollectionCategoryManageModal();
    renderBackpack();
  };
}

/** 收藏分类重命名模态 */
function openCollectionCategoryRenameModal(name) {
  openModal(
    '<h3 class="modal-title">重命名收藏分类</h3>' +
    '<div class="form-row"><label>名称</label><input id="colCatRename" maxlength="30" value="' + escapeHtml(name) + '"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="ccrCancel">取消</button>' +
      '<button class="btn btn-primary" id="ccrSave">保存</button>' +
    '</div>'
  );
  const cancelBtn = document.getElementById('ccrCancel');
  if (cancelBtn) cancelBtn.onclick = closeModal;
  const saveBtn = document.getElementById('ccrSave');
  if (saveBtn) saveBtn.onclick = function () {
    const res = renameCollectionCategory(name, val('colCatRename').trim());
    if (!res.ok) { toast(res.error); return; }
    closeModal();
    renderBackpack();
    openCollectionCategoryManageModal();
  };
}

/** P1-3 搜索输入：即时过滤重渲并恢复焦点（input 事件，本地数据量小不做防抖） */
function handleCollectionSearchInput(value) {
  collectionSearchKeyword = String(value == null ? '' : value);
  renderBackpack();
  const input = document.getElementById('collectionSearch');
  if (input && typeof input.focus === 'function') input.focus();
}

  /* ---- 导出公共 API 到 EO 命名空间并同步到全局（兼容旧引用 / 测试桩） ---- */
  E.collectionCatFilter = collectionCatFilter;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.collectionCatFilter === "undefined") globalThis.collectionCatFilter = collectionCatFilter; } catch (e) {}
  E.collectionSearchKeyword = collectionSearchKeyword;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.collectionSearchKeyword === "undefined") globalThis.collectionSearchKeyword = collectionSearchKeyword; } catch (e) {}
  E.pendingFile = pendingFile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.pendingFile === "undefined") globalThis.pendingFile = pendingFile; } catch (e) {}
  E.pendingRelinkId = pendingRelinkId;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.pendingRelinkId === "undefined") globalThis.pendingRelinkId = pendingRelinkId; } catch (e) {}
  E.collectionFiles = collectionFiles;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.collectionFiles === "undefined") globalThis.collectionFiles = collectionFiles; } catch (e) {}
  E.attachCollectionFile = attachCollectionFile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.attachCollectionFile === "undefined") globalThis.attachCollectionFile = attachCollectionFile; } catch (e) {}
  E.getCollectionBlobUrl = getCollectionBlobUrl;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.getCollectionBlobUrl === "undefined") globalThis.getCollectionBlobUrl = getCollectionBlobUrl; } catch (e) {}
  E.hasLiveFile = hasLiveFile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.hasLiveFile === "undefined") globalThis.hasLiveFile = hasLiveFile; } catch (e) {}
  E.detachCollectionFile = detachCollectionFile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.detachCollectionFile === "undefined") globalThis.detachCollectionFile = detachCollectionFile; } catch (e) {}
  E.formatFileSize = formatFileSize;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.formatFileSize === "undefined") globalThis.formatFileSize = formatFileSize; } catch (e) {}
  E.renderCollectionsTab = renderCollectionsTab;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderCollectionsTab === "undefined") globalThis.renderCollectionsTab = renderCollectionsTab; } catch (e) {}
  E.renderCollectionCategory = renderCollectionCategory;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderCollectionCategory === "undefined") globalThis.renderCollectionCategory = renderCollectionCategory; } catch (e) {}
  E.renderCollectionCard = renderCollectionCard;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.renderCollectionCard === "undefined") globalThis.renderCollectionCard = renderCollectionCard; } catch (e) {}
  E.openCollectionModal = openCollectionModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openCollectionModal === "undefined") globalThis.openCollectionModal = openCollectionModal; } catch (e) {}
  E.handleCollectionSave = handleCollectionSave;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleCollectionSave === "undefined") globalThis.handleCollectionSave = handleCollectionSave; } catch (e) {}
  E.openCollectionDetail = openCollectionDetail;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openCollectionDetail === "undefined") globalThis.openCollectionDetail = openCollectionDetail; } catch (e) {}
  E.confirmDeleteCollection = confirmDeleteCollection;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.confirmDeleteCollection === "undefined") globalThis.confirmDeleteCollection = confirmDeleteCollection; } catch (e) {}
  E.triggerCollectionFileAttach = triggerCollectionFileAttach;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.triggerCollectionFileAttach === "undefined") globalThis.triggerCollectionFileAttach = triggerCollectionFileAttach; } catch (e) {}
  E.triggerCollectionRelink = triggerCollectionRelink;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.triggerCollectionRelink === "undefined") globalThis.triggerCollectionRelink = triggerCollectionRelink; } catch (e) {}
  E.handleCollectionRelink = handleCollectionRelink;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleCollectionRelink === "undefined") globalThis.handleCollectionRelink = handleCollectionRelink; } catch (e) {}
  E.openActionLabel = openActionLabel;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openActionLabel === "undefined") globalThis.openActionLabel = openActionLabel; } catch (e) {}
  E.openCollectionFile = openCollectionFile;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openCollectionFile === "undefined") globalThis.openCollectionFile = openCollectionFile; } catch (e) {}
  E.handleCollectionCategoryFilter = handleCollectionCategoryFilter;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleCollectionCategoryFilter === "undefined") globalThis.handleCollectionCategoryFilter = handleCollectionCategoryFilter; } catch (e) {}
  E.openCollectionCategoryManageModal = openCollectionCategoryManageModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openCollectionCategoryManageModal === "undefined") globalThis.openCollectionCategoryManageModal = openCollectionCategoryManageModal; } catch (e) {}
  E.openCollectionCategoryRenameModal = openCollectionCategoryRenameModal;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.openCollectionCategoryRenameModal === "undefined") globalThis.openCollectionCategoryRenameModal = openCollectionCategoryRenameModal; } catch (e) {}
  E.handleCollectionSearchInput = handleCollectionSearchInput;
  try { if (typeof globalThis !== "undefined" && typeof globalThis.handleCollectionSearchInput === "undefined") globalThis.handleCollectionSearchInput = handleCollectionSearchInput; } catch (e) {}
})();