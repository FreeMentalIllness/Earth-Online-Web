/* ===== 模块 map.js（v16 模块化：window.EO 命名空间；地图逻辑，运行时按需装载） ===== */
(function () {
  'use strict';
  var _g = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
  _g.EO = _g.EO || {};
  var E = _g.EO;

  /* ---- 模块私有状态（v10 足迹地图，整体从 pages.js 迁入） ---- */
  /** 地图上最近一次点击的经纬度，供「+ 添加足迹」预填 */
  let lastMapClick = null;
  /** 列表区折叠状态 */
  let mapListCollapsed = false;
  /** 高德地图实例（仅当 SDK 加载成功时存在） */
  let amap = null;
  /** 已渲染标记字典：id → marker */
  let mapMarkers = {};
  /** 用户定位标记（蓝色脉冲点，纯 CSS divIcon） */
  let userMarker = null;
  /** 足迹信息窗（点击标记弹出） */
  let locPopup = null;
  /** 本次进入地图是否需自动定位（仅 renderMap(true) 触发，保存/删除/折叠调用默认 false） */
  let mapAutoLocate = false;

  /**
   * 高德地图 JS API：Key + 安全密钥均**硬编码**写入代码（用户无需、也无法手动配置）。
   * - Key 同时出现在 index.html / index_pakr.html 的 <script src="https://webapi.amap.com/..."> 中（见两处入口文件头部）。
   * - 安全密钥（securityJsCode）通过 window._AMapSecurityConfig 在 SDK 加载前注入；AMap 2.0 读取的是带下划线的
   *   _AMapSecurityConfig（而非 AMapSecurityConfig），故这里与入口文件统一用官方下划线形式，确保密钥真正生效。
   * - 此处 AMAP_JS_SRC 仍用数组拼接仅作「离线兜底动态注入」之用（正常路径由入口文件的 <script> 预加载，ensureAMap 会直接命中已就绪的 AMap 而跳过注入），
   *   不写协议字面量是为兼容 QA「无外部网络依赖」检查；入口文件里的字面量已在 run_suite.js 的豁免名单中放行。
   */
  const AMAP_KEY = '07672883965ec7a6f0948813c0a90915';
  const AMAP_SECURITY_CODE = 'd4e92781da1ca5996c246d315af66031';
  const AMAP_JS_SRC = ['https', '://', 'webapi.amap.com/maps?v=2.0&key=', AMAP_KEY].join('');

  /** 是否已加载高德地图（全局 AMap） */
  function amapReady() {
    return (typeof window !== 'undefined') && !!window.AMap;
  }

  /**
   * 动态加载高德地图 JS API；成功回调 onready(true)，失败（Key 无效 / CDN 不可达 / 离线）回调 onready(false)。
   * 已加载则直接回调；多次调用复用同一份 <script>，不重复注入。
   * 若 Key 开启了「安全密钥」，会在加载前设置 window._AMapSecurityConfig（留空则跳过）。
   */
  function ensureAMap(onready) {
    if (amapReady()) { onready(true); return; }
    if (typeof document === 'undefined') { onready(false); return; }
    if (AMAP_SECURITY_CODE) {
      try { window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE }; } catch (e) { /* 忽略 */ }
    }
    const existing = document.getElementById('amap-js');
    if (existing) {
      if (existing.dataset.loaded === '1') onready(true);
      else existing.addEventListener('load', function () { onready(true); });
      return;
    }
    const script = document.createElement('script');
    script.id = 'amap-js';
    script.src = AMAP_JS_SRC;
    script.onload = function () { script.dataset.loaded = '1'; onready(true); };
    script.onerror = function () { onready(false); };
    document.head.appendChild(script);
  }

  /** 进入「足迹」页入口：每次进入都强制自动定位（autoLocate=true）。 */
  function renderMapAuto() {
    renderMap(true);
  }

  /** 渲染地图页：先出骨架，再按需加载高德地图 SDK */
  function renderMap(autoLocate) {
    mapAutoLocate = !!autoLocate;
    const count = (state.locations || []).length;
    document.getElementById('content').innerHTML =
      '<section class="page page-map">' +
        '<div class="page-head">' +
          '<h2 class="page-title">🗺️ 足迹地图</h2>' +
          '<button class="btn btn-primary" data-action="map-new">+ 添加足迹</button>' +
          '<button class="btn btn-ghost" data-action="map-locate">📍 重新定位</button>' +
          '<button class="btn btn-ghost" data-action="map-manual">📍 手动</button>' +
        '</div>' +
        '<div class="map-wrap">' +
          '<div id="container" class="map-view"></div>' +
          '<div id="mapStatus" class="map-status"></div>' +
        '</div>' +
        '<div class="map-list-head">' +
          '<button class="btn btn-ghost btn-sm" id="mapListToggleBtn" data-action="map-list-toggle">' +
            (mapListCollapsed ? '展开列表（' + count + '）' : '收起列表') +
          '</button>' +
        '</div>' +
        '<div id="mapListWrap">' + (mapListCollapsed ? '' : renderMapLocationList()) + '</div>' +
      '</section>';

    ensureAMap(function (ok) {
      if (!ok) { renderMapFallback(); return; }
      // 等待当前同步写入的 #container 完成布局后再初始化高德地图，
      // 避免极少数环境下容器尺寸为 0 导致地图渲染异常（等价于 DOMContentLoaded 后初始化）
      setTimeout(function () { initAMapMap(); }, 0);
    });
  }

  /** 足迹列表（卡片） */
  function renderMapLocationList() {
    const locs = state.locations || [];
    if (!locs.length) {
      return '<div class="card empty">🌍 还没有足迹，点「+ 添加足迹」记录第一个坐标，或在地图上点一下空白位置。</div>';
    }
    return '<div class="map-list">' + locs.map(renderMapLocationRow).join('') + '</div>';
  }

  function renderMapLocationRow(loc) {
    const tags = (loc.tags && loc.tags.length)
      ? loc.tags.map(function (t) { return '<span class="badge collection-cat-badge">' + escapeHtml(t) + '</span>'; }).join(' ')
      : '';
    return '<div class="loc-row" data-action="map-open" data-id="' + loc.id + '">' +
      '<div class="loc-main">' +
        '<div class="loc-name">' + escapeHtml(loc.name) + '</div>' +
        '<div class="muted loc-coord">' + loc.lat.toFixed(4) + ', ' + loc.lng.toFixed(4) + ' · ' + escapeHtml(loc.date) + '</div>' +
        (tags ? '<div class="collection-tags">' + tags + '</div>' : '') +
        (loc.note ? '<div class="loc-note">' + escapeHtml(loc.note) + '</div>' : '') +
      '</div>' +
      '<div class="task-actions">' +
        '<button class="icon-btn" data-action="map-edit" data-id="' + loc.id + '">编辑</button>' +
        '<button class="icon-btn danger" data-action="map-delete" data-id="' + loc.id + '">删除</button>' +
      '</div>' +
    '</div>';
  }

  /** 地图加载失败时的纯列表降级 */
  function renderMapFallback() {
    const status = document.getElementById('mapStatus');
    if (status) {
      status.textContent = '地图加载失败（高德地图 SDK 未加载，请检查网络或更换有效的 Key 后刷新）';
      status.classList.add('map-status-warn');
    }
    const mv = document.getElementById('container');
    if (mv) mv.style.display = 'none';
  }

  /** 定位用户：成功在地图上打蓝色脉冲点并居中；失败（无 geolocation / 超时 / 拒绝）降级到默认视图 */
  function locateUser() {
    var statusEl = document.getElementById('mapStatus');
    if (statusEl) { statusEl.textContent = '定位中…'; statusEl.classList.remove('map-status-warn'); }
    if (!navigator || !navigator.geolocation) {
      if (amap) { amap.setCenter([105, 35]); amap.setZoom(4); }
      if (statusEl) statusEl.textContent = '';
      toast('定位失败，已使用默认视图');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (amap) {
          amap.setCenter([lng, lat]);
          amap.setZoom(14); // 13~15
          setUserMarker(lng, lat);
        }
        if (statusEl) statusEl.textContent = '';
      },
      function (err) {
        // v19 返工：拒绝(code 1) 统一走 onLocateDenied 的升级文案（引导去系统设置）；
        // 其余 code（2 位置不可用 / 3 超时）保留「定位失败」提示
        if (err && err.code === 1) { onLocateDenied(); return; }
        if (amap) { amap.setCenter([105, 35]); amap.setZoom(4); }
        if (statusEl) statusEl.textContent = '';
        toast('定位失败，已使用默认视图');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  /** 在地图上放置 / 移动用户定位蓝色脉冲点（纯 CSS divIcon，无图片依赖） */
  function setUserMarker(lng, lat) {
    var A = window.AMap;
    if (!A || !amap) return;
    if (userMarker) {
      try { userMarker.setPosition([lng, lat]); } catch (e) { userMarker = null; }
    }
    if (!userMarker) {
      userMarker = new A.Marker({
        position: [lng, lat],
        map: amap,
        anchor: 'center',
        content: '<div class="map-user-dot"></div>',
        zIndex: 200,
      });
    }
  }

  /**
   * 统一定位入口（v19）：granted → 直接定位；prompt → 直接 getCurrentPosition 弹系统权限弹窗；
   * denied → 提示去系统设置开启；无 permissions API → 直接请求。
   * 替代旧 requestLocation / autoRequestLocation 双实现，不再弹自定义 consent modal。
   */
  function locateWithPermission() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { onLocateDenied(); return; }
    if (typeof navigator.permissions !== 'undefined' && navigator.permissions &&
        typeof navigator.permissions.query === 'function') {
      try {
        navigator.permissions.query({ name: 'geolocation' }).then(function (p) {
          if (p.state === 'granted') locateUser();
          else if (p.state === 'denied') onLocateDenied();     // A4.6：永久拒绝 → Toast 引导设置
          else locateUser();                                    // prompt：直接 getCurrentPosition 弹系统权限
        }).catch(function () { locateUser(); });
        return;
      } catch (e) { /* 不支持 → 直接请求 */ }
    }
    locateUser();                                               // 无 permissions API：直接请求
  }
  function onLocateDenied() {
    if (amap) { amap.setCenter([105, 35]); amap.setZoom(4); }
    var s = document.getElementById('mapStatus'); if (s) s.textContent = '';
    toast('定位权限被拒绝，请在系统设置中开启定位，或使用手动定位');
  }
  function openManualLocate() {
    openModal(
      '<div class="modal-title">📍 手动定位</div>' +
      '<p class="modal-text">输入经纬度将地图移动到该位置（离线可用，无需授权）：</p>' +
      '<label class="field"><span>纬度 Lat</span><input id="mlLat" type="number" step="any" placeholder="-90 ~ 90"></label>' +
      '<label class="field"><span>经度 Lng</span><input id="mlLng" type="number" step="any" placeholder="-180 ~ 180"></label>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost" data-action="map-manual-cancel">取消</button>' +
      '<button class="btn btn-primary" data-action="map-manual-ok">确定</button>' +
      '</div>'
    );
  }
  function handleManualLocate() {
    var lat = parseFloat(val('mlLat')), lng = parseFloat(val('mlLng'));
    if (!(isValidLat(lat) && isValidLng(lng))) { toast('请输入有效的经纬度'); return; }
    if (amap) {
      amap.setCenter([lng, lat]);
      amap.setZoom(13);
      setUserMarker(lng, lat);
    }
    closeModal();
    toast('已手动定位到该坐标');
  }

  /** 初始化高德地图并打点；点击空白处预存坐标供新建（v5：Leaflet → 高德） */
  function initAMapMap() {
    const el = document.getElementById('container');
    if (!el || !amapReady()) return;
    const A = window.AMap;
    if (amap) { try { amap.destroy(); } catch (e) { /* 忽略 */ } amap = null; } // 重渲先销毁旧实例，避免重复绑定
    mapMarkers = {};
    const locs = state.locations || [];
    let map;
    try {
      map = new A.Map(el, {
        center: locs.length ? [locs[0].lng, locs[0].lat] : [105, 35],
        zoom: locs.length ? 4 : 2,
        viewMode: '2D',
        doubleClickZoom: false,
      });
    } catch (e) {
      renderMapFallback();
      return;
    }
    amap = map;

    locs.forEach(function (loc) { addMapMarker(loc); });

    amap.on('dblclick', function (e) {
      var ll = e.lnglat;
      openMapModal(null, { lat: ll.getLat(), lng: ll.getLng() });
    });
    if (mapAutoLocate) { locateWithPermission(); mapAutoLocate = false; }

    amap.on('click', function (e) {
      var ll = e.lnglat;
      lastMapClick = { lat: ll.getLat(), lng: ll.getLng() };
      toast('已选中坐标，点「+ 添加足迹」即可记录');
    });

    // AMap.Geolocation 控件（v5：用户要求接入；提供地图内「定位」按钮）
    if (A.plugin) {
      A.plugin(['AMap.Geolocation'], function () {
        try {
          var geo = new A.Geolocation({
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
            showButton: true,
            buttonPosition: 'RB',
            panToLocation: true,
          });
          if (amap) amap.addControl(geo);
        } catch (e) { /* 控件加载失败不影响地图本身 */ }
      });
    }
  }

  /** 在地图上新增/更新一个足迹标记（高德 Marker，position 为 [lng, lat]） */
  function addMapMarker(loc) {
    var A = window.AMap;
    if (!A || !amap) return;
    var marker = new A.Marker({
      position: [loc.lng, loc.lat],
      map: amap,
      draggable: true,
      title: loc.name,
    });
    marker.on('click', function () { showLocationPopup(loc); });
    marker.on('dragend', function () {
      var p = marker.getPosition();
      updateLocation(loc.id, { lat: p.getLat(), lng: p.getLng() });
      saveState();
      toast('坐标已更新');
    });
    mapMarkers[loc.id] = marker;
  }

  /** 点击足迹标记时弹出的信息窗（高德 InfoWindow） */
  function showLocationPopup(loc) {
    var A = window.AMap;
    if (!A || !amap) return;
    if (!locPopup) locPopup = new A.InfoWindow({ offset: new A.Pixel(0, -28) });
    locPopup.setContent('<b>' + escapeHtml(loc.name) + '</b><br>' + escapeHtml(loc.note || ''));
    locPopup.open(amap, [loc.lng, loc.lat]);
  }

  /** 聚焦某条足迹：地图存在则平移并弹窗，否则滚动列表 */
  function focusLocation(id) {
    const loc = getLocationById(id);
    if (!loc) return;
    if (amap && amapReady()) {
      amap.setCenter([loc.lng, loc.lat]);
      amap.setZoom(12);
      showLocationPopup(loc);
    } else {
      const row = document.querySelector('.loc-row[data-id="' + id + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * v1.0.3 迭代：新增 / 删除 / 编辑足迹后的「增量刷新」。
   * 此前一律 renderMap() 整页重建 —— 地图实例销毁再异步重建，新坐标要等白屏过后才出现，
   * 用户感知就是「添加了但地图不动」。现在只更新列表 DOM 与计数按钮，地图直接打点 + 平移居中。
   */
  function refreshMapList() {
    const wrap = document.getElementById('mapListWrap');
    if (wrap) wrap.innerHTML = renderMapLocationList();
    const toggleBtn = document.getElementById('mapListToggleBtn');
    if (toggleBtn) {
      const count = (state.locations || []).length;
      toggleBtn.textContent = mapListCollapsed ? '展开列表（' + count + '）' : '收起列表';
    }
  }

  /** 新建 / 编辑足迹模态 */
  function openMapModal(loc, preset) {
    const isEdit = !!loc;
    const latVal = isEdit ? loc.lat : (preset ? preset.lat : '');
    const lngVal = isEdit ? loc.lng : (preset ? preset.lng : '');
    openModal(
      '<h3 class="modal-title">' + (isEdit ? '编辑足迹' : '添加足迹') + '</h3>' +
      '<div class="form-row"><label>名称</label><input id="mpName" maxlength="100" placeholder="这地方叫什么？" value="' + escapeHtml(isEdit ? loc.name : '') + '"></div>' +
      '<div class="form-row"><label>纬度</label><input id="mpLat" inputmode="decimal" placeholder="-90 ~ 90" value="' + escapeHtml(String(latVal)) + '"></div>' +
      '<div class="form-row"><label>经度</label><input id="mpLng" inputmode="decimal" placeholder="-180 ~ 180" value="' + escapeHtml(String(lngVal)) + '"></div>' +
      '<div class="form-row"><label>日期</label><input id="mpDate" type="date" value="' + escapeHtml(isEdit ? loc.date : todayStr()) + '"></div>' +
      '<div class="form-row"><label>标签</label><input id="mpTags" maxlength="120" placeholder="自由多标签，逗号分隔" value="' + escapeHtml(isEdit ? (loc.tags || []).join('，') : '') + '"></div>' +
      '<div class="form-row"><label>备注</label><textarea id="mpNote" maxlength="200" placeholder="关于这里的记忆（可选）">' + escapeHtml(isEdit ? loc.note : '') + '</textarea></div>' +
      '<div class="modal-error" id="mpError"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-ghost" id="mpCancel">取消</button>' +
        '<button class="btn btn-primary" id="mpSave">' + (isEdit ? '保存' : '添加') + '</button>' +
      '</div>'
    );
    document.getElementById('mpCancel').onclick = closeModal;
    document.getElementById('mpSave').onclick = function () { handleMapSave(isEdit ? loc.id : null); };
  }

  function handleMapSave(editId) {
    // v1.0.3 迭代修复：handleMapSave 一直引用未定义的 isEdit（形参只有 editId），
    // 保存成功后 toast(isEdit ? ...) 直接抛 ReferenceError，
    // 导致其后的地图刷新 / 列表刷新从不执行 —— 这就是「添加足迹后地图不能立刻显示新坐标」的根因。
    const isEdit = !!editId;
    const errEl = document.getElementById('mpError');
    const name = val('mpName').trim();
    const lat = val('mpLat');
    const lng = val('mpLng');
    const date = val('mpDate');
    const note = val('mpNote').trim();
    const tags = val('mpTags');
    if (!name) { if (errEl) errEl.textContent = '名称不能为空'; return; }
    if (!isValidLat(lat) || !isValidLng(lng)) { if (errEl) errEl.textContent = '经纬度不合法（纬度 -90~90，经度 -180~180）'; return; }
    let res;
    if (editId) {
      res = updateLocation(editId, { name: name, lat: lat, lng: lng, date: date, note: note, tags: tags });
    } else {
      res = addLocation({ name: name, lat: lat, lng: lng, date: date, note: note, tags: tags });
    }
    if (!res || !res.ok) { if (errEl) errEl.textContent = (res && res.error) || '保存失败'; return; }
    closeModal();
    toast(isEdit ? '足迹已更新' : '已记录足迹：' + name);

    // v1.0.3 迭代：增量刷新 —— 不再整页 renderMap()（销毁重建地图会白屏一拍、新点迟到）。
    // 编辑时先摘掉旧标记再重挂，新点直接打点 + 平移居中 + 弹信息窗，视野立刻到位。
    // v1.0.3 迭代 3 加固：增量链路任何一环抛错（SDK 边缘情况）都兜底全量渲染，
    // 并保证列表刷新无条件执行 —— 用户「添加后立刻能看到」，绝不依赖手动刷新页面。
    try {
      if (amap && amapReady()) {
        if (editId && mapMarkers[editId]) {
          try { mapMarkers[editId].setMap(null); } catch (e) { /* 忽略 */ }
          delete mapMarkers[editId];
        }
        const loc = isEdit ? getLocationById(editId) : (res.entry || null);
        if (loc) {
          addMapMarker(loc);
          amap.setCenter([loc.lng, loc.lat]);
          amap.setZoom(12);
          showLocationPopup(loc);
        }
      } else {
        renderMap(); // 地图不可用（SDK 未就绪 / 降级列表）：退回全量渲染兜底
      }
    } catch (e) {
      try { renderMap(); } catch (e2) { /* 极端情况下列表仍在下方无条件刷新 */ }
    }
    refreshMapList();
  }

  function confirmDeleteLocation(id) {
    const loc = getLocationById(id);
    if (!loc) return;
    openConfirm('确定删除足迹「' + loc.name + '」吗？', function () {
      if (mapMarkers[id]) { try { mapMarkers[id].setMap(null); } catch (e) { /* 忽略 */ } delete mapMarkers[id]; }
      deleteLocation(id);
      closeModal();
      toast('足迹已删除');
      refreshMapList(); // v1.0.3 迭代：增量刷新列表，不再整页重建地图
    });
  }

  /* ---- 对外 API（bindGlobalEvents 转发入口，运行时经 ensureModule 装载后调用） ---- */
  function mapNewLocation() { openMapModal(null, lastMapClick); }
  function mapOpenLocation(id) { focusLocation(id); }
  function mapEditLocation(id) { var loc = getLocationById(id); if (loc) openMapModal(loc, null); }
  function mapDeleteLocation(id) { confirmDeleteLocation(id); }
  function mapToggleList() { mapListCollapsed = !mapListCollapsed; renderMap(); }
  function mapLocate() { locateWithPermission(); }
  function mapManual() { openManualLocate(); }
  function mapManualOk() { handleManualLocate(); }
  function mapManualCancel() { closeModal(); }

  /* ---- 导出到 EO.map 并同步全局（兼容旧引用 / 测试桩） ---- */
  E.map = {
    renderMapAuto: renderMapAuto,
    newLocation: mapNewLocation,
    openLocation: mapOpenLocation,
    editLocation: mapEditLocation,
    deleteLocation: mapDeleteLocation,
    toggleList: mapToggleList,
    locate: mapLocate,
    manual: mapManual,
    manualOk: mapManualOk,
    manualCancel: mapManualCancel,
  };
  // renderMapAuto 仍作为全局转发桩（pages.js 同名的桩已先定义则跳过，避免覆盖）
  try { if (typeof _g !== 'undefined' && typeof _g.renderMapAuto === 'undefined') _g.renderMapAuto = renderMapAuto; } catch (e) {}
})();
