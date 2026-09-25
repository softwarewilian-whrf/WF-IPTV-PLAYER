/**
 * ============================================================
 * WF IPTV PLAYER - SCRIPT PRINCIPAL CORRIGIDO (SUPORTE HTTPS)
 * ============================================================
 */

class IPTVEngine {

  constructor() {
    this.serverUrl = '';
    this.username = '';
    this.password = '';
    this.userInfo = null;
    this.serverInfo = null;
    this.hlsPlayer = null;
    this.currentType = 'live';
    this.categories = [];
    this.currentCategoryId = null;
    this.currentItems = [];
    this.filteredItems = [];
    this.selectedItemIndex = -1;
  }

  /* ==========================================================
     PROXY PARA SUPORTE A HTTPS E MIXED CONTENT
     ========================================================== */

  formatUrlWithProxy(url) {
    if (!url) return '';
    const cleanUrl = String(url).trim();
    if (!cleanUrl) return '';

    // Se o servidor IPTV já é HTTPS, envia a requisição direta (sem Proxy)
    if (cleanUrl.toLowerCase().startsWith('https://')) {
      return cleanUrl;
    }

    // Apenas se o site estiver em HTTPS e o link for HTTP (Mixed Content), utiliza o Proxy
    if (
      window.location.protocol === 'https:' &&
      cleanUrl.toLowerCase().startsWith('http://')
    ) {
      return 'https://corsproxy.io/?url=' + encodeURIComponent(cleanUrl);
    }

    return cleanUrl;
  }

  /* ==========================================================
     FETCH JSON
     ========================================================== */

  async fetchJson(url, description) {
    console.log('[IPTV] Requisição:', description || 'API');
    console.log('[IPTV] URL:', url);

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' - ' + response.statusText);
      }

      return await response.json();
    } catch (error) {
      console.error('[IPTV] Erro na requisição:', description || 'API', error);
      throw error;
    }
  }

  /* ==========================================================
     LOGIN XTREAM
     ========================================================== */

  async login(serverUrl, username, password) {
    this.serverUrl = String(serverUrl || '').trim().replace(/\/+$/, '');
    this.username = String(username || '').trim();
    this.password = String(password || '').trim();

    if (!this.serverUrl || !this.username || !this.password) {
      return {
        success: false,
        message: 'Preencha servidor, utilizador e palavra-passe.'
      };
    }

    const rawApiUrl =
      this.serverUrl +
      '/player_api.php?username=' +
      encodeURIComponent(this.username) +
      '&password=' +
      encodeURIComponent(this.password);

    const apiUrl = this.formatUrlWithProxy(rawApiUrl);

    try {
      const data = await this.fetchJson(apiUrl, 'Autenticação');

      if (data && data.user_info && Number(data.user_info.auth) === 1) {
        this.userInfo = data.user_info;
        this.serverInfo = data.server_info || null;

        console.log('[IPTV] Login realizado com sucesso.');

        return {
          success: true,
          user: this.userInfo,
          server: this.serverInfo
        };
      }

      console.error('[IPTV] Servidor recusou a autenticação.');
      return {
        success: false,
        message: 'Utilizador ou palavra-passe inválidos.'
      };

    } catch (error) {
      console.error('[IPTV] Erro de autenticação:', error);
      return {
        success: false,
        message: 'Não foi possível conectar ao servidor. Verifique o endereço e os dados de acesso.'
      };
    }
  }

  /* ==========================================================
     CATEGORIAS
     ========================================================== */

  async getCategories(type) {
    const actionMap = {
      live: 'get_live_categories',
      movies: 'get_vod_categories',
      series: 'get_series_categories'
    };

    const action = actionMap[type] || actionMap.live;

    const rawUrl =
      this.serverUrl +
      '/player_api.php?username=' +
      encodeURIComponent(this.username) +
      '&password=' +
      encodeURIComponent(this.password) +
      '&action=' +
      action;

    const url = this.formatUrlWithProxy(rawUrl);

    try {
      const data = await this.fetchJson(url, 'Categorias - ' + type);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('[IPTV] Erro ao procurar categorias:', type, error);
      return [];
    }
  }

  /* ==========================================================
     STREAMS / CANAIS / FILMES / SÉRIES
     ========================================================== */

  async getStreams(type, categoryId = null) {
    const actionMap = {
      live: 'get_live_streams',
      movies: 'get_vod_streams',
      series: 'get_series'
    };

    const action = actionMap[type] || actionMap.live;

    let rawUrl =
      this.serverUrl +
      '/player_api.php?username=' +
      encodeURIComponent(this.username) +
      '&password=' +
      encodeURIComponent(this.password) +
      '&action=' +
      action;

    if (categoryId !== null && categoryId !== undefined && categoryId !== '') {
      rawUrl += '&category_id=' + encodeURIComponent(categoryId);
    }

    const url = this.formatUrlWithProxy(rawUrl);

    try {
      const data = await this.fetchJson(url, 'Streams - ' + type);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('[IPTV] Erro ao carregar streams:', type, error);
      return [];
    }
  }

  /* ==========================================================
     INFORMAÇÕES DA SÉRIE
     ========================================================== */

  async getSeriesInfo(seriesId) {
    const rawUrl =
      this.serverUrl +
      '/player_api.php?username=' +
      encodeURIComponent(this.username) +
      '&password=' +
      encodeURIComponent(this.password) +
      '&action=get_series_info' +
      '&series_id=' +
      encodeURIComponent(seriesId);

    const url = this.formatUrlWithProxy(rawUrl);

    try {
      return await this.fetchJson(url, 'Informações da série');
    } catch (error) {
      console.error('[IPTV] Erro ao procurar episódios:', error);
      return null;
    }
  }

  /* ==========================================================
     URL DO STREAM (CANAIS AO VIVO EM HLS)
     ========================================================== */

  getStreamUrl(streamId, containerExtension = null, type = 'live', directSource = null) {
    if (directSource && String(directSource).trim() !== '') {
      return String(directSource).trim();
    }

    if (streamId === null || streamId === undefined || streamId === '') {
      console.error('[IPTV] stream_id inválido.');
      return '';
    }

    const user = encodeURIComponent(this.username);
    const pass = encodeURIComponent(this.password);
    const id = encodeURIComponent(streamId);
    let rawUrl = '';

    // CANAIS AO VIVO: Força o formato .m3u8 para compatibilidade HLS
    if (type === 'live') {
      rawUrl = `${this.serverUrl}/live/${user}/${pass}/${id}.m3u8`;
    } 
    // FILMES
    else if (type === 'movies') {
      let ext = containerExtension ? String(containerExtension).replace(/^\./, '') : 'mp4';
      rawUrl = `${this.serverUrl}/movie/${user}/${pass}/${id}.${ext}`;
    } 
    // SÉRIES
    else if (type === 'series') {
      let ext = containerExtension ? String(containerExtension).replace(/^\./, '') : 'mp4';
      rawUrl = `${this.serverUrl}/series/${user}/${pass}/${id}.${ext}`;
    }

    console.log('[IPTV] URL original do stream:', rawUrl);
    return rawUrl;
  }

  /* ==========================================================
     DETECTAR FORMATO
     ========================================================== */

  detectStreamType(streamUrl) {
    const url = String(streamUrl || '').toLowerCase();

    if (url.includes('.m3u8') || url.includes('m3u8')) return 'hls';
    if (url.includes('.mp4')) return 'mp4';
    if (url.includes('.ts')) return 'ts';

    return 'unknown';
  }

  /* ==========================================================
     LIMPAR PLAYER
     ========================================================== */

  resetVideo(videoElement) {
    if (!videoElement) return;
    try {
      videoElement.pause();
    } catch (error) {
      console.warn('[IPTV] Erro ao pausar vídeo:', error);
    }
    videoElement.removeAttribute('src');
    videoElement.load();
  }

  /* ==========================================================
     PLAYER (REPRODUÇÃO DE CANAIS E MÍDIAS)
     ========================================================== */

  playStream(videoElement, streamUrl) {
    if (!videoElement) {
      console.error('[IPTV] Elemento #video-player não encontrado.');
      return;
    }

    if (!streamUrl) {
      console.error('[IPTV] URL do stream está vazia.');
      alert('Não foi possível encontrar a URL deste conteúdo.');
      return;
    }

    // Destrói a instância HLS anterior para evitar sobreposição
    if (this.hlsPlayer) {
      try {
        this.hlsPlayer.destroy();
      } catch (error) {
        console.warn('[IPTV] Erro ao destruir HLS anterior:', error);
      }
      this.hlsPlayer = null;
    }

    this.resetVideo(videoElement);

    const originalUrl = String(streamUrl).trim();
    const finalStreamUrl = this.formatUrlWithProxy(originalUrl);
    const streamType = this.detectStreamType(originalUrl);

    console.log('[IPTV] INICIANDO STREAM:', {
      tipo: this.currentType,
      formato: streamType,
      urlOriginal: originalUrl,
      urlFinal: finalStreamUrl
    });

    /* --- REPRODUÇÃO HLS (.m3u8) --- */
    if (streamType === 'hls' || this.currentType === 'live') {
      const hlsSupported = typeof window.Hls !== 'undefined' && window.Hls.isSupported();

      if (hlsSupported) {
        console.log('[IPTV] Utilizando HLS.js.');

        this.hlsPlayer = new window.Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
          liveSyncDurationCount: 3,
          maxBufferLength: 30
        });

        this.hlsPlayer.loadSource(finalStreamUrl);
        this.hlsPlayer.attachMedia(videoElement);

        this.hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
          videoElement.play().catch(error => console.warn('[IPTV] Autoplay bloqueado:', error));
        });

        this.hlsPlayer.on(window.Hls.Events.ERROR, (event, data) => {
          console.error('[IPTV] Erro HLS:', data);
          if (data && data.fatal) {
            if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
              this.hlsPlayer.startLoad();
            } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
              this.hlsPlayer.recoverMediaError();
            } else {
              this.hlsPlayer.destroy();
            }
          }
        });
        return;
      }

      // HLS Nativo (ex: Safari / iOS)
      if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        console.log('[IPTV] Utilizando HLS nativo.');
        videoElement.src = finalStreamUrl;
        videoElement.play().catch(error => console.warn('[IPTV] Autoplay bloqueado:', error));
        return;
      }

      alert('O seu navegador não suporta a reprodução HLS.');
      return;
    }

    /* --- REPRODUÇÃO MP4 OU NATIVA --- */
    videoElement.src = finalStreamUrl;
    videoElement.play().catch(error => {
      console.error('[IPTV] Erro ao reproduzir vídeo:', error);
      alert('Não foi possível reproduzir este vídeo.');
    });
  }

  stopStream(videoElement) {
    if (this.hlsPlayer) {
      try {
        this.hlsPlayer.destroy();
      } catch (error) {
        console.warn('[IPTV] Erro ao destruir HLS:', error);
      }
      this.hlsPlayer = null;
    }
    if (videoElement) {
      this.resetVideo(videoElement);
    }
  }
}

/* ============================================================
   INSTÂNCIA GLOBAL E INICIALIZAÇÃO
   ============================================================ */

const iptv = new IPTVEngine();

document.addEventListener('DOMContentLoaded', () => {
  console.log('[IPTV] Aplicação iniciada.');

  if (window.lucide) {
    lucide.createIcons();
  }

  startClock();

  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', event => {
      const query = String(event.target.value || '').toLowerCase().trim();
      iptv.filteredItems = iptv.currentItems.filter(item => {
        const name = String(item.name || '').toLowerCase();
        const title = String(item.title || '').toLowerCase();
        return name.includes(query) || title.includes(query);
      });
      renderCatalogGrid(iptv.filteredItems);
    });
  }
});

/* ============================================================
   FUNÇÕES AUXILIARES DE INTERFACE
   ============================================================ */

function startClock() {
  const clockEl = document.getElementById('clock');
  if (!clockEl) return;
  const updateClock = () => {
    clockEl.innerText = new Date().toLocaleTimeString('pt-PT');
  };
  updateClock();
  setInterval(updateClock, 1000);
}

function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

async function handleLogin(event) {
  event.preventDefault();
  const urlInput = document.getElementById('server-url');
  const userInput = document.getElementById('username');
  const passInput = document.getElementById('password');

  const btn = event.target.querySelector('button');
  let originalText = btn ? btn.innerText : 'ENTRAR';

  if (btn) {
    btn.innerText = 'A LIGAR...';
    btn.disabled = true;
  }

  const result = await iptv.login(
    urlInput ? urlInput.value : '',
    userInput ? userInput.value : '',
    passInput ? passInput.value : ''
  );

  if (btn) {
    btn.innerText = originalText;
    btn.disabled = false;
  }

  if (result.success) {
    switchScreen('dashboard-screen');
  } else {
    alert(result.message);
  }
}

function logout() {
  const video = document.getElementById('video-player');
  iptv.stopStream(video);
  switchScreen('login-screen');
}

async function openCatalog(type) {
  iptv.currentType = type;
  iptv.selectedItemIndex = -1;

  const catalogTitle = document.getElementById('catalog-title');
  const labels = { live: 'CANAIS AO VIVO', movies: 'FILMES (VOD)', series: 'SÉRIES' };
  if (catalogTitle) catalogTitle.innerText = labels[type] || 'CATÁLOGO';

  switchScreen('catalog-screen');

  const categoriesList = document.getElementById('category-list');
  if (categoriesList) categoriesList.innerHTML = '<li class="category-item">A carregar...</li>';

  const grid = document.getElementById('catalog-grid');
  if (grid) grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#888;">Selecione uma categoria...</p>';

  const categories = await iptv.getCategories(type);
  iptv.categories = categories;
  renderCategorySidebar(categories);

  if (categories && categories.length > 0) {
    await selectCategory(categories[0].category_id);
  }
}

function renderCategorySidebar(categories) {
  const list = document.getElementById('category-list');
  if (!list) return;

  list.innerHTML = '';
  if (!categories || categories.length === 0) {
    list.innerHTML = '<li class="category-item">Nenhuma categoria encontrada</li>';
    return;
  }

  categories.forEach(category => {
    const li = document.createElement('li');
    li.className = 'category-item';
    li.dataset.id = category.category_id;

    const span = document.createElement('span');
    span.innerText = category.category_name || 'Sem categoria';

    li.appendChild(span);
    li.onclick = () => selectCategory(category.category_id);
    list.appendChild(li);
  });
}

async function selectCategory(categoryId) {
  iptv.currentCategoryId = categoryId;

  document.querySelectorAll('.category-item').forEach(element => {
    element.classList.toggle('active', element.dataset.id == categoryId);
  });

  const grid = document.getElementById('catalog-grid');
  if (grid) grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#888;">A carregar conteúdos...</p>';

  const items = await iptv.getStreams(iptv.currentType, categoryId);
  iptv.currentItems = items;
  iptv.filteredItems = items;
  renderCatalogGrid(items);
}

function renderCatalogGrid(items) {
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;

  grid.innerHTML = '';
  if (!items || items.length === 0) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#888;">Nenhum conteúdo nesta categoria.</p>';
    return;
  }

  const svgPlaceholder = `
    <svg xmlns="http://www.w3.org/2000/svg" width="150" height="225" viewBox="0 0 150 225">
      <rect width="150" height="225" fill="#121a14"/>
      <text x="75" y="112" dominant-baseline="middle" text-anchor="middle" fill="#888888" font-size="12" font-family="Arial, sans-serif">Sem Imagem</text>
    </svg>`;
  const placeholderImg = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgPlaceholder);

  items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'media-card';

    const name = item.name || item.title || 'Sem título';
    let rawIcon = String(item.stream_icon || item.cover || '').trim();

    const image = document.createElement('img');
    image.className = 'media-poster';
    image.alt = name;
    image.loading = 'lazy';
    image.src = rawIcon ? iptv.formatUrlWithProxy(rawIcon) : placeholderImg;

    image.onerror = function() {
      this.onerror = null;
      this.src = placeholderImg;
    };

    const title = document.createElement('span');
    title.title = name;
    title.innerText = name;

    card.appendChild(image);
    card.appendChild(title);
    card.onclick = () => onMediaCardClick(item, index);

    grid.appendChild(card);
  });
}

async function onMediaCardClick(item, index) {
  iptv.selectedItemIndex = index;

  if (iptv.currentType === 'series') {
    switchScreen('player-screen');
    await loadSeriesEpisodes(item);
    return;
  }

  const streamId = item.stream_id;
  if (streamId === undefined || streamId === null || streamId === '') {
    alert('Este conteúdo não possui um stream_id válido.');
    return;
  }

  const streamUrl = iptv.getStreamUrl(
    streamId,
    item.container_extension || null,
    iptv.currentType,
    item.direct_source || item.directSource || null
  );

  startPlayerScreen(item.name || item.title || 'A reproduzir', streamUrl);
  renderSidebarPlaylist(iptv.filteredItems, index);
}

async function loadSeriesEpisodes(seriesItem) {
  const titleEl = document.getElementById('playing-title');
  if (titleEl) titleEl.innerText = seriesItem.name || 'Série';

  const sidebarList = document.getElementById('sidebar-list');
  if (!sidebarList) return;

  sidebarList.innerHTML = '<li class="sidebar-item">A carregar episódios...</li>';

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
    header.style.cssText = 'font-weight:bold; color:#00ff66; background:#0d140e;';
    header.innerText = 'TEMPORADA ' + seasonNum;
    sidebarList.appendChild(header);

    const episodes = Array.isArray(data.episodes[seasonNum]) ? data.episodes[seasonNum] : [];

    episodes.forEach(episode => {
      const epLi = document.createElement('li');
      epLi.className = 'sidebar-item';
      epLi.innerText = 'E' + episode.episode_num + ' - ' + (episode.title || 'Episódio');

      const streamUrl = iptv.getStreamUrl(episode.id, episode.container_extension || 'mp4', 'series');

      if (!firstEpisodeUrl) {
        firstEpisodeUrl = streamUrl;
        firstEpisodeTitle = `${seriesItem.name || 'Série'} - T${seasonNum}:E${episode.episode_num}`;
      }

      epLi.onclick = () => {
        document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
        epLi.classList.add('active');
        if (titleEl) titleEl.innerText = `${seriesItem.name || 'Série'} - T${seasonNum}:E${episode.episode_num}`;
        iptv.playStream(document.getElementById('video-player'), streamUrl);
      };

      sidebarList.appendChild(epLi);
    });
  });

  if (firstEpisodeUrl) {
    if (titleEl) titleEl.innerText = firstEpisodeTitle;
    iptv.playStream(document.getElementById('video-player'), firstEpisodeUrl);
  }
}

function startPlayerScreen(title, streamUrl) {
  switchScreen('player-screen');
  const titleEl = document.getElementById('playing-title');
  if (titleEl) titleEl.innerText = title || 'A reproduzir';

  const video = document.getElementById('video-player');
  iptv.playStream(video, streamUrl);
}

function renderSidebarPlaylist(items, currentIndex) {
  const sidebarList = document.getElementById('sidebar-list');
  if (!sidebarList) return;

  sidebarList.innerHTML = '';
  if (!items || items.length === 0) {
    sidebarList.innerHTML = '<li class="sidebar-item">Nenhum conteúdo disponível.</li>';
    return;
  }

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'sidebar-item';
    if (index === currentIndex) li.classList.add('active');

    const name = item.name || item.title || 'Sem título';
    li.innerText = name;

    li.onclick = () => {
      iptv.selectedItemIndex = index;
      renderSidebarPlaylist(items, index);

      const streamUrl = iptv.getStreamUrl(
        item.stream_id,
        item.container_extension || null,
        iptv.currentType,
        item.direct_source || item.directSource || null
      );

      startPlayerScreen(name, streamUrl);
    };

    sidebarList.appendChild(li);
  });
}

/* ============================================================
   CONTROLES DO PLAYER
   ============================================================ */

function playMediaControl() {
  const video = document.getElementById('video-player');
  if (video) video.play().catch(error => console.warn('[IPTV] Não foi possível iniciar:', error));
}

function pauseMediaControl() {
  const video = document.getElementById('video-player');
  if (video) video.pause();
}

function stopMediaControl() {
  const video = document.getElementById('video-player');
  if (video) iptv.stopStream(video);
}

function nextMedia() {
  if (iptv.selectedItemIndex >= 0 && iptv.selectedItemIndex < iptv.filteredItems.length - 1) {
    const nextIndex = iptv.selectedItemIndex + 1;
    onMediaCardClick(iptv.filteredItems[nextIndex], nextIndex);
  }
}

function prevMedia() {
  if (iptv.selectedItemIndex > 0) {
    const previousIndex = iptv.selectedItemIndex - 1;
    onMediaCardClick(iptv.filteredItems[previousIndex], previousIndex);
  }
}