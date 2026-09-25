/**
 * WF IPTV PLAYER ENGINE
 * Integrado com a Interface HTML5 / CSS
 */

class IPTVEngine {
  constructor() {
    this.serverUrl = '';
    this.username = '';
    this.password = '';
    this.userInfo = null;
    this.serverInfo = null;
    this.hlsPlayer = null;

    // Estado do App
    this.currentType = 'live'; // 'live' | 'movies' | 'series'
    this.categories = [];
    this.currentCategoryId = null;
    this.currentItems = [];
    this.filteredItems = [];
    this.selectedItemIndex = -1;
  }

  /**
   * Helper para evitar Mixed Content (HTTP em HTTPS) e problemas de CORS
   */
  formatUrlWithProxy(url) {
    if (!url) return '';
    // Se o site está em HTTPS e a URL de mídia é HTTP, usa o proxy
    if (window.location.protocol === 'https:' && url.startsWith('http://')) {
      return `https://corsproxy.io/?${encodeURIComponent(url)}`;
    }
    return url;
  }

  /**
   * 1. Autenticação na API Xtream Codes
   */
  async login(serverUrl, username, password) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.username = encodeURIComponent(username);
    this.password = encodeURIComponent(password);

    const rawApiUrl = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}`;
    const apiUrl = this.formatUrlWithProxy(rawApiUrl);

    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error(`Erro na rede: ${response.status}`);

      const data = await response.json();

      if (data.user_info && data.user_info.auth === 1) {
        this.userInfo = data.user_info;
        this.serverInfo = data.server_info;
        return { success: true, user: this.userInfo, server: this.serverInfo };
      } else {
        return { success: false, message: 'Usuário ou senha inválidos.' };
      }
    } catch (error) {
      console.error('Erro de autenticação:', error);
      return { 
        success: false, 
        message: 'Não foi possível conectar ao servidor. Verifique a URL e credenciais.' 
      };
    }
  }

  /**
   * 2. Obter Categorias
   */
  async getCategories(type) {
    const actionMap = {
      live: 'get_live_categories',
      movies: 'get_vod_categories',
      series: 'get_series_categories'
    };

    const action = actionMap[type] || actionMap.live;
    const rawUrl = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=${action}`;
    const url = this.formatUrlWithProxy(rawUrl);

    try {
      const response = await fetch(url);
      return await response.json();
    } catch (error) {
      console.error(`Erro ao buscar categorias (${type}):`, error);
      return [];
    }
  }

  /**
   * 3. Obter Conteúdos/Canais
   */
  async getStreams(type, categoryId = null) {
    const actionMap = {
      live: 'get_live_streams',
      movies: 'get_vod_streams',
      series: 'get_series'
    };

    const action = actionMap[type] || actionMap.live;
    let rawUrl = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=${action}`;

    if (categoryId) {
      rawUrl += `&category_id=${categoryId}`;
    }

    const url = this.formatUrlWithProxy(rawUrl);

    try {
      const response = await fetch(url);
      return await response.json();
    } catch (error) {
      console.error(`Erro ao carregar itens (${type}):`, error);
      return [];
    }
  }

  /**
   * 4. Detalhes de Séries / Episódios
   */
  async getSeriesInfo(seriesId) {
    const rawUrl = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=get_series_info&series_id=${seriesId}`;
    const url = this.formatUrlWithProxy(rawUrl);

    try {
      const response = await fetch(url);
      return await response.json();
    } catch (error) {
      console.error('Erro ao buscar episódios da série:', error);
      return null;
    }
  }

  /**
   * 5. Monta a URL de Reprodução (Com correção para Mixed Content no GitHub Pages)
   */
  getStreamUrl(streamId, containerExtension = null, type = 'live') {
    let rawUrl = '';

    if (type === 'live') {
      const ext = containerExtension ? containerExtension : 'm3u8';
      rawUrl = `${this.serverUrl}/live/${this.username}/${this.password}/${streamId}.${ext}`;
    } else if (type === 'movies') {
      const ext = containerExtension ? containerExtension : 'mp4';
      rawUrl = `${this.serverUrl}/movie/${this.username}/${this.password}/${streamId}.${ext}`;
    } else if (type === 'series') {
      const ext = containerExtension ? containerExtension : 'mp4';
      rawUrl = `${this.serverUrl}/series/${this.username}/${this.password}/${streamId}.${ext}`;
    }

    // Aplica o proxy HTTPS para evitar o bloqueio de "Mixed Content" do navegador
    return this.formatUrlWithProxy(rawUrl);
  }

  /**
   * 6. Tocador de Vídeo Otimizado com suporte HLS e Fallbacks
   */
  playStream(videoElement, streamUrl) {
    if (this.hlsPlayer) {
      this.hlsPlayer.destroy();
      this.hlsPlayer = null;
    }

    const isLive = this.currentType === 'live';
    const isM3U8 = streamUrl.includes('.m3u8');

    if (Hls.isSupported() && (isM3U8 || isLive)) {
      this.hlsPlayer = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxBufferLength: 30
      });

      this.hlsPlayer.loadSource(streamUrl);
      this.hlsPlayer.attachMedia(videoElement);

      this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        videoElement.play().catch(e => console.log('Autoplay bloqueado:', e));
      });

      this.hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('Erro de rede no canal ao vivo. Tentando reconectar...');
              this.hlsPlayer.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('Erro de mídia. Tentando recuperar...');
              this.hlsPlayer.recoverMediaError();
              break;
            default:
              console.error('Erro fatal no HLS.js. Tentando HTML5 nativo...');
              this.hlsPlayer.destroy();
              this.hlsPlayer = null;
              videoElement.src = streamUrl;
              videoElement.play().catch(() => {});
              break;
          }
        }
      });
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = streamUrl;
      videoElement.play().catch(e => console.log('Autoplay bloqueado:', e));
    } else {
      videoElement.src = streamUrl;
      videoElement.play().catch(e => console.log('Autoplay bloqueado:', e));
    }
  }
}

// Instância Global
const iptv = new IPTVEngine();

/* =========================================================
   CONTROLADORES DA INTERFACE (UI INTEGRATION)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  startClock();

  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      iptv.filteredItems = iptv.currentItems.filter(item =>
        (item.name && item.name.toLowerCase().includes(query)) ||
        (item.title && item.title.toLowerCase().includes(query))
      );
      renderCatalogGrid(iptv.filteredItems);
    });
  }
});

function startClock() {
  const clockEl = document.getElementById('clock');
  if (!clockEl) return;
  setInterval(() => {
    const now = new Date();
    clockEl.innerText = now.toLocaleTimeString('pt-BR');
  }, 1000);
}

function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

async function handleLogin(event) {
  event.preventDefault();
  const url = document.getElementById('server-url').value;
  const user = document.getElementById('username').value;
  const pass = document.getElementById('password').value;

  const btn = event.target.querySelector('button');
  const originalText = btn.innerText;
  btn.innerText = 'CONECTANDO...';
  btn.disabled = true;

  const result = await iptv.login(url, user, pass);

  btn.innerText = originalText;
  btn.disabled = false;

  if (result.success) {
    switchScreen('dashboard-screen');
  } else {
    alert(result.message);
  }
}

function logout() {
  const video = document.getElementById('video-player');
  if (video) {
    video.pause();
    video.src = '';
  }
  if (iptv.hlsPlayer) iptv.hlsPlayer.destroy();
  switchScreen('login-screen');
}

async function openCatalog(type) {
  iptv.currentType = type;
  const catalogTitle = document.getElementById('catalog-title');
  
  const labels = {
    live: 'CANAIS AO VIVO',
    movies: 'FILMES (VOD)',
    series: 'SÉRIES'
  };
  if (catalogTitle) catalogTitle.innerText = labels[type] || 'CATÁLOGO';

  switchScreen('catalog-screen');

  const categoriesList = document.getElementById('category-list');
  categoriesList.innerHTML = '<li class="category-item">Carregando...</li>';

  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #888;">Selecione uma categoria...</p>';

  const categories = await iptv.getCategories(type);
  iptv.categories = categories;

  renderCategorySidebar(categories);

  if (categories && categories.length > 0) {
    selectCategory(categories[0].category_id);
  }
}

function renderCategorySidebar(categories) {
  const list = document.getElementById('category-list');
  list.innerHTML = '';

  if (!categories || categories.length === 0) {
    list.innerHTML = '<li class="category-item">Nenhuma categoria encontrada</li>';
    return;
  }

  categories.forEach(cat => {
    const li = document.createElement('li');
    li.className = 'category-item';
    li.dataset.id = cat.category_id;
    li.innerHTML = `<span>${cat.category_name}</span>`;
    li.onclick = () => selectCategory(cat.category_id);
    list.appendChild(li);
  });
}

async function selectCategory(categoryId) {
  iptv.currentCategoryId = categoryId;

  document.querySelectorAll('.category-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id == categoryId);
  });

  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #888;">Carregando conteúdos...</p>';

  const items = await iptv.getStreams(iptv.currentType, categoryId);
  iptv.currentItems = items;
  iptv.filteredItems = items;

  renderCatalogGrid(items);
}

function renderCatalogGrid(items) {
  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = '';

  if (!items || items.length === 0) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #888;">Nenhum conteúdo nesta categoria.</p>';
    return;
  }

  const placeholderImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='225' viewBox='0 0 150 225'><rect width='100%' height='100%' fill='%23121a14'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%23888888' font-size='12' font-family='sans-serif'>Sem Imagem</text></svg>";

  items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'media-card';

    const name = item.name || item.title || 'Sem título';
    const rawIcon = (item.stream_icon && item.stream_icon.trim() !== '') 
      ? item.stream_icon 
      : (item.cover || placeholderImg);

    const icon = rawIcon.startsWith('http') ? iptv.formatUrlWithProxy(rawIcon) : rawIcon;

    card.innerHTML = `
      <img class="media-poster" src="${icon}" onerror="this.onerror=null; this.src='${placeholderImg}';" alt="${name}" loading="lazy">
      <span title="${name}">${name}</span>
    `;

    card.onclick = () => onMediaCardClick(item, index);
    grid.appendChild(card);
  });
}

async function onMediaCardClick(item, index) {
  iptv.selectedItemIndex = index;

  if (iptv.currentType === 'series') {
    switchScreen('player-screen');
    loadSeriesEpisodes(item);
  } else {
    const streamId = item.stream_id;
    const ext = item.container_extension || null;
    const streamUrl = iptv.getStreamUrl(streamId, ext, iptv.currentType);

    startPlayerScreen(item.name || item.title, streamUrl);
    renderSidebarPlaylist(iptv.filteredItems, index);
  }
}

async function loadSeriesEpisodes(seriesItem) {
  const titleEl = document.getElementById('playing-title');
  if (titleEl) titleEl.innerText = seriesItem.name;

  const sidebarList = document.getElementById('sidebar-list');
  sidebarList.innerHTML = '<li class="sidebar-item">Carregando episódios...</li>';

  const data = await iptv.getSeriesInfo(seriesItem.series_id);

  if (!data || !data.episodes) {
    sidebarList.innerHTML = '<li class="sidebar-item">Nenhum episódio encontrado.</li>';
    return;
  }

  sidebarList.innerHTML = '';
  let firstEpisodeUrl = null;
  let firstEpisodeTitle = '';

  Object.keys(data.episodes).forEach(seasonNum => {
    const header = document.createElement('li');
    header.className = 'sidebar-item';
    header.style.fontWeight = 'bold';
    header.style.color = '#00ff66';
    header.style.background = '#0d140e';
    header.innerText = `TEMPORADA ${seasonNum}`;
    sidebarList.appendChild(header);

    data.episodes[seasonNum].forEach(ep => {
      const epLi = document.createElement('li');
      epLi.className = 'sidebar-item';
      epLi.innerText = `E${ep.episode_num} - ${ep.title}`;

      const streamUrl = iptv.getStreamUrl(ep.id, ep.container_extension || 'mp4', 'series');

      if (!firstEpisodeUrl) {
        firstEpisodeUrl = streamUrl;
        firstEpisodeTitle = `${seriesItem.name} - T${seasonNum}:E${ep.episode_num}`;
      }

      epLi.onclick = () => {
        document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
        epLi.classList.add('active');
        if (titleEl) titleEl.innerText = `${seriesItem.name} - T${seasonNum}:E${ep.episode_num}`;
        const video = document.getElementById('video-player');
        iptv.playStream(video, streamUrl);
      };

      sidebarList.appendChild(epLi);
    });
  });

  if (firstEpisodeUrl) {
    if (titleEl) titleEl.innerText = firstEpisodeTitle;
    const video = document.getElementById('video-player');
    iptv.playStream(video, firstEpisodeUrl);
  }
}

function startPlayerScreen(title, streamUrl) {
  switchScreen('player-screen');
  const titleEl = document.getElementById('playing-title');
  if (titleEl) titleEl.innerText = title;

  const video = document.getElementById('video-player');
  iptv.playStream(video, streamUrl);
}

function renderSidebarPlaylist(items, currentIndex) {
  const sidebarList = document.getElementById('sidebar-list');
  sidebarList.innerHTML = '';

  items.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'sidebar-item' + (idx === currentIndex ? ' active' : '');
    const name = item.name || item.title;
    li.innerText = name;

    li.onclick = () => {
      iptv.selectedItemIndex = idx;
      renderSidebarPlaylist(items, idx);

      const ext = item.container_extension || null;
      const streamUrl = iptv.getStreamUrl(item.stream_id, ext, iptv.currentType);
      startPlayerScreen(name, streamUrl);
    };

    sidebarList.appendChild(li);
  });
}

/* =========================================================
   CONTROLES DO PLAYER
   ========================================================= */

function playMediaControl() {
  const video = document.getElementById('video-player');
  if (video) video.play();
}

function pauseMediaControl() {
  const video = document.getElementById('video-player');
  if (video) video.pause();
}

function stopMediaControl() {
  const video = document.getElementById('video-player');
  if (video) {
    video.pause();
    video.currentTime = 0;
  }
}

function nextMedia() {
  if (iptv.selectedItemIndex >= 0 && iptv.selectedItemIndex < iptv.filteredItems.length - 1) {
    const nextIdx = iptv.selectedItemIndex + 1;
    onMediaCardClick(iptv.filteredItems[nextIdx], nextIdx);
  }
}

function prevMedia() {
  if (iptv.selectedItemIndex > 0) {
    const prevIdx = iptv.selectedItemIndex - 1;
    onMediaCardClick(iptv.filteredItems[prevIdx], prevIdx);
  }
}