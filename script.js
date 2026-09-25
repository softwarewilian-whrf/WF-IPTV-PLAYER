lucide.createIcons();

let activeSection = 'live';
let currentData = { live: [], movies: [], series: [] };
let categoriesData = { live: [], movies: [], series: [] };
let groupedData = {};
let activeCategory = 'TODOS';
let currentPlaylist = [];
let currentIndex = -1;
let hlsPlayer = null;
let currentCredentials = { url: '', user: '', pass: '' };

// Relógio em tempo real
setInterval(() => {
  const clock = document.getElementById('clock');
  if (clock) clock.innerText = new Date().toLocaleTimeString();
}, 1000);

window.addEventListener('DOMContentLoaded', () => {
  const savedData = localStorage.getItem('xc_user_session');
  if (savedData) {
    try {
      const session = JSON.parse(savedData);
      document.getElementById('server-url').value = session.url || '';
      if (document.getElementById('username')) document.getElementById('username').value = session.user || '';
      if (document.getElementById('password')) document.getElementById('password').value = session.pass || '';
      autoLogin(session);
    } catch (e) {
      console.error(e);
    }
  }

  const video = document.getElementById('video-player');
  if (video) {
    video.addEventListener('ended', () => {
      if (currentIndex < currentPlaylist.length - 1) {
        nextMedia();
      }
    });
  }
});

// Função auxiliar exigida pelo HTML para alternar campos de servidor se necessário
function toggleFields() {
  // Mantido para compatibilidade com o evento onchange do index.html
}

/* =========================================================
   AGRUPAMENTO POR CATEGORIAS OFICIAIS DO SERVIDOR IPTV
   ========================================================= */

function categorizeContent(section, items, categoriesList) {
  const groups = { 'TODOS': [...items] };

  const categoryMap = {};
  if (Array.isArray(categoriesList)) {
    categoriesList.forEach(cat => {
      const catName = cat.category_name.trim().toUpperCase();
      categoryMap[cat.category_id] = catName;
      if (!groups[catName]) groups[catName] = [];
    });
  }

  items.forEach(item => {
    let catName = categoryMap[item.category_id];

    if (!catName) {
      const nameUpper = item.name.toUpperCase();
      if (section === 'live') {
        if (nameUpper.includes('GLOBO')) catName = 'CANAIS GLOBO';
        else if (nameUpper.includes('SBT')) catName = 'CANAIS SBT';
        else if (nameUpper.includes('RECORD')) catName = 'CANAIS RECORD';
        else if (nameUpper.includes('TELECINE')) catName = 'TELECINE';
        else if (nameUpper.includes('HBO') || nameUpper.includes('MAX')) catName = 'HBO / MAX';
        else if (nameUpper.includes('SPORTV') || nameUpper.includes('ESPN') || nameUpper.includes('PREMIERE')) catName = 'DESPORTOS';
        else if (nameUpper.includes('INFANTIL') || nameUpper.includes('DISNEY') || nameUpper.includes('NICK')) catName = 'INFANTIL';
        else catName = 'OUTROS';
      } else {
        catName = 'OUTROS';
      }
    }

    if (!groups[catName]) groups[catName] = [];
    groups[catName].push(item);
  });

  Object.keys(groups).forEach(key => {
    if (groups[key].length === 0 && key !== 'TODOS') {
      delete groups[key];
    }
  });

  return groups;
}

function renderCategorySidebar(groups) {
  const sidebar = document.getElementById('category-list');
  if (!sidebar) return;

  sidebar.innerHTML = '';
  const categories = Object.keys(groups);

  categories.forEach(cat => {
    const li = document.createElement('li');
    li.className = 'category-item' + (cat === activeCategory ? ' active' : '');
    li.innerHTML = `<span>${cat}</span> <span class="count">${groups[cat].length}</span>`;

    li.onclick = () => {
      activeCategory = cat;
      document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
      li.classList.add('active');
      renderCatalogGrid(groups[cat]);
    };

    sidebar.appendChild(li);
  });
}

/* =========================================================
   CONEXÃO COM A API E DEFINIÇÃO DE LINKS HTTPS SEGUROS
   ========================================================= */

async function connectXtream(baseUrl, user, pass) {
  const isVercel = window.location.hostname.includes('vercel.app') || (window.location.hostname !== 'localhost' && !window.location.hostname.includes('github.io'));
  const proxyBase = isVercel ? '/api-proxy' : baseUrl.replace(/\/$/, "");
  
  const authUrl = `${proxyBase}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;

  const authTest = await fetchWithFallback(authUrl);
  if (!authTest || !authTest.user_info || authTest.user_info.auth === 0) {
    throw new Error('Utilizador ou palavra-passe inválidos.');
  }

  const [
    liveCats, vodCats, seriesCats,
    liveData, vodData, seriesData
  ] = await Promise.all([
    fetchWithFallback(`${authUrl}&action=get_live_categories`).catch(() => []),
    fetchWithFallback(`${authUrl}&action=get_vod_categories`).catch(() => []),
    fetchWithFallback(`${authUrl}&action=get_series_categories`).catch(() => []),
    fetchWithFallback(`${authUrl}&action=get_live_streams`).catch(() => []),
    fetchWithFallback(`${authUrl}&action=get_vod_streams`).catch(() => []),
    fetchWithFallback(`${authUrl}&action=get_series`).catch(() => [])
  ]);

  categoriesData.live = liveCats;
  categoriesData.movies = vodCats;
  categoriesData.series = seriesCats;

  let cleanServerUrl = baseUrl.replace(/\/$/, "");
  if (cleanServerUrl.startsWith('http://')) {
    cleanServerUrl = cleanServerUrl.replace('http://', 'https://');
  }

  // CORREÇÃO: Forçar formato .m3u8 (HLS) para os canais ao vivo funcionarem no browser
  if (Array.isArray(liveData)) {
    currentData.live = liveData.map(i => ({
      name: i.name || 'Canal',
      cover: getValidCoverUrl(i.stream_icon, cleanServerUrl),
      category_id: i.category_id,
      url: `${cleanServerUrl}/live/${user}/${pass}/${i.stream_id}.m3u8`
    }));
  }

  // CORREÇÃO: Forçar formato .mp4 universal para os filmes abrirem sem falhas de codec/container
  if (Array.isArray(vodData)) {
    currentData.movies = vodData.map(i => {
      return {
        name: i.name || 'Filme',
        cover: getValidCoverUrl(i.stream_icon || i.cover, cleanServerUrl),
        category_id: i.category_id,
        url: `${cleanServerUrl}/movie/${user}/${pass}/${i.stream_id}.mp4`
      };
    });
  }

  if (Array.isArray(seriesData)) {
    currentData.series = seriesData.map(i => ({
      name: i.name || 'Série',
      cover: getValidCoverUrl(i.cover || i.stream_icon, cleanServerUrl),
      category_id: i.category_id,
      series_id: i.series_id,
      isSeries: true
    }));
  }
}

/* =========================================================
   NAVEGAÇÃO E EXIBIÇÃO DO CATÁLOGO
   ========================================================= */

function openCatalog(section) {
  activeSection = section;
  activeCategory = 'TODOS';

  const titleElem = document.getElementById('catalog-title');
  if (titleElem) titleElem.innerText = section.toUpperCase();

  switchScreen('catalog-screen');

  groupedData = categorizeContent(section, currentData[section] || [], categoriesData[section] || []);
  renderCategorySidebar(groupedData);
  renderCatalogGrid(groupedData['TODOS'] || []);
}

function renderCatalogGrid(items) {
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const defaultPlaceholder = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='450' viewBox='0 0 300 450'><rect width='100%' height='100%' fill='%23121a14'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%2300ff66' font-family='sans-serif' font-size='18'>SEM LOGO</text></svg>";

  if (!items || items.length === 0) {
    grid.innerHTML = '<p style="padding: 20px; color: #888; grid-column: 1/-1;">Nenhum conteúdo nesta categoria.</p>';
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'media-card';
    const imgSrc = (item.cover && item.cover.trim() !== '' && !item.cover.includes('null')) ? item.cover : defaultPlaceholder;

    card.innerHTML = `
      <img class="media-poster" src="${imgSrc}" alt="${item.name}" loading="lazy" referrerpolicy="no-referrer"
           onerror="if (this.src !== '${defaultPlaceholder}') { this.onerror = null; this.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(this.src); } else { this.src = '${defaultPlaceholder}'; }" />
      <span title="${item.name}">${item.name}</span>
    `;

    card.onclick = () => {
      if (item.isSeries) {
        loadSeriesEpisodes(item);
      } else {
        startPlayerView(item, items);
      }
    };

    grid.appendChild(card);
  });
}

function startPlayerView(selectedItem, fullList) {
  currentPlaylist = fullList;
  currentIndex = fullList.findIndex(i => i.name === selectedItem.name);
  if (currentIndex === -1) currentIndex = 0;

  switchScreen('player-screen');
  renderSidebarList(currentPlaylist, currentPlaylist[currentIndex]);
  playMedia(currentPlaylist[currentIndex]);
}

/* =========================================================
   PLAYER DE VÍDEO
   ========================================================= */

function playMedia(item) {
  const video = document.getElementById('video-player');
  const titleEl = document.getElementById('playing-title');
  if (titleEl) titleEl.innerText = item.name;

  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }

  let streamUrl = item.url;
  if (streamUrl && streamUrl.startsWith('http://')) {
    streamUrl = streamUrl.replace('http://', 'https://');
  }

  if (Hls.isSupported() && (streamUrl.includes('.m3u8') || streamUrl.includes('.ts') || streamUrl.includes('live') || streamUrl.includes('movie'))) {
    hlsPlayer = new Hls({ 
      enableWorker: true,
      xhrSetup: function (xhr, url) {
        xhr.withCredentials = false;
      }
    });
    hlsPlayer.loadSource(streamUrl);
    hlsPlayer.attachMedia(video);
    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hlsPlayer.on(Hls.Events.ERROR, function (event, data) {
      console.error("Erro no Hls.js:", data);
    });
  } else {
    video.src = streamUrl;
    video.play().catch(() => {});
  }
}

function playMediaControl() { document.getElementById('video-player')?.play(); }
function pauseMediaControl() { document.getElementById('video-player')?.pause(); }
function stopMediaControl() {
  const video = document.getElementById('video-player');
  if (video) { video.pause(); video.currentTime = 0; }
}

function nextMedia() {
  if (currentIndex < currentPlaylist.length - 1) {
    currentIndex++;
    const nextItem = currentPlaylist[currentIndex];
    renderSidebarList(currentPlaylist, nextItem);
    playMedia(nextItem);
  }
}

function prevMedia() {
  if (currentIndex > 0) {
    currentIndex--;
    const prevItem = currentPlaylist[currentIndex];
    renderSidebarList(currentPlaylist, prevItem);
    playMedia(prevItem);
  }
}

async function loadSeriesEpisodes(series) {
  const { url, user, pass } = currentCredentials;
  let cleanUrl = url.replace(/\/$/, "");
  if (cleanUrl.startsWith('http://')) cleanUrl = cleanUrl.replace('http://', 'https://');

  const isVercel = window.location.hostname.includes('vercel.app') || (window.location.hostname !== 'localhost' && !window.location.hostname.includes('github.io'));
  const proxyBase = isVercel ? '/api-proxy' : cleanUrl;
  
  const episodesUrl = `${proxyBase}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&action=get_series_info&series_id=${series.series_id}`;

  try {
    const data = await fetchWithFallback(episodesUrl);
    let episodesList = [];

    if (data && data.episodes) {
      Object.keys(data.episodes).forEach(season => {
        data.episodes[season].forEach(ep => {
          let ext = ep.container_extension || 'mp4';
          let epUrl = `${cleanUrl}/series/${user}/${pass}/${ep.id}.${ext}`;

          episodesList.push({
            name: `T${season}:E${ep.episode_num} - ${ep.title || 'Episódio'}`,
            cover: getValidCoverUrl(ep.info?.movie_image || series.cover, cleanUrl),
            url: epUrl
          });
        });
      });
    }

    if (episodesList.length > 0) {
      startPlayerView(episodesList[0], episodesList);
    } else {
      alert('Nenhum episódio encontrado.');
    }
  } catch (err) {
    alert('Erro ao carregar episódios.');
  }
}

function renderSidebarList(items, currentActive) {
  const sidebar = document.getElementById('sidebar-list');
  if (!sidebar) return;

  sidebar.innerHTML = '';
  items.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'sidebar-item' + (idx === currentIndex ? ' active' : '');
    li.innerHTML = `<span>${item.name}</span>`;

    li.onclick = () => {
      currentIndex = idx;
      document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
      li.classList.add('active');
      playMedia(item);
    };

    sidebar.appendChild(li);
  });
}

async function fetchWithFallback(url) {
  try {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      try { return JSON.parse(text); } catch (err) {}
    }
  } catch (e) {}

  try {
    const res1 = await fetch("https://corsproxy.io/?" + encodeURIComponent(url));
    if (res1.ok) {
      const text1 = await res1.text();
      try { return JSON.parse(text1); } catch (err) {}
    }
  } catch (e) {}

  try {
    const res2 = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(url));
    if (res2.ok) {
      const text2 = await res2.text();
      try { return JSON.parse(text2); } catch (err) {}
    }
  } catch (e) {}

  throw new Error('Falha na resposta do servidor ou formato inválido.');
}

function getValidCoverUrl(coverPath, baseUrl) {
  if (!coverPath || typeof coverPath !== 'string' || coverPath.trim() === '') return '';
  let fullUrl = coverPath.trim();
  if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
    fullUrl = baseUrl.replace(/\/$/, "") + (fullUrl.startsWith('/') ? fullUrl : '/' + fullUrl);
  }
  if (fullUrl.startsWith('http://')) fullUrl = fullUrl.replace('http://', 'https://');
  return fullUrl.includes('images.weserv.nl') ? fullUrl : "https://images.weserv.nl/?url=" + encodeURIComponent(fullUrl);
}

function switchScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  lucide.createIcons();
}

async function autoLogin(session) {
  currentCredentials = session;
  await connectXtream(session.url, session.user, session.pass);
  switchScreen('dashboard-screen');
}

async function handleLogin(e) {
  e.preventDefault();
  const submitBtn = document.querySelector('.btn-signin');
  if (submitBtn) { submitBtn.innerText = "AUTENTICANDO..."; submitBtn.disabled = true; }

  const url = document.getElementById('server-url').value.trim();
  const user = document.getElementById('username')?.value.trim() || '';
  const pass = document.getElementById('password')?.value.trim() || '';

  currentCredentials = { url, user, pass };

  try {
    await connectXtream(url, user, pass);
    localStorage.setItem('xc_user_session', JSON.stringify({ url, user, pass }));
    switchScreen('dashboard-screen');
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  } finally {
    if (submitBtn) { submitBtn.innerText = "ENTRAR"; submitBtn.disabled = false; }
  }
}

function logout() {
  localStorage.removeItem('xc_user_session');
  switchScreen('login-screen');
}

document.getElementById('catalog-search-input')?.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  const baseItems = groupedData[activeCategory] || [];
  const filtered = baseItems.filter(i => i.name.toLowerCase().includes(term));
  renderCatalogGrid(filtered);
});