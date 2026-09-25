// Configuração da API e Proxy no Cloudflare Worker
const BASE_URL = 'https://nivok.xyz/player_api.php';
const STREAM_BASE_URL = 'https://nivok.xyz/live';
const PROXY_URL = 'https://rapid-voice-4ddf.softwarewilian.workers.dev/?url=';

// Variáveis globais
let globalUsername = '';
let globalPassword = '';
let currentMode = 'live'; // 'live', 'movies', 'series'
let currentStreams = [];
let currentPlaylist = []; // Lista para reprodução automática contínua
let currentIndex = -1;
let hlsInstance = null;
let seriesEpisodesData = {}; // Cache de episódios da série atual
let favoritesList = []; // Armazenamento de favoritos

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
        lucide.createIcons();
    }
    startClock();
    setupAutoplay();
    setupDashboardButtons();
});

// Relógio do Cabeçalho
function startClock() {
    const clockElement = document.getElementById('clock');
    if (!clockElement) return;
    
    setInterval(() => {
        const now = new Date();
        clockElement.textContent = now.toLocaleTimeString('pt-PT');
    }, 1000);
}

// Configura evento de Autoplay para mudar automaticamente de episódio ao terminar
function setupAutoplay() {
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
        videoPlayer.addEventListener('ended', () => {
            console.log('[IPTV] Vídeo finalizado. A mudar para o próximo item...');
            playNextItem();
        });
    }
}

// Vincula todos os botões sem ação prévia
function setupDashboardButtons() {
    const btnSearch = document.getElementById('btn-header-search');
    const btnBell = document.getElementById('btn-header-bell');
    const btnMultiHeader = document.getElementById('btn-header-multi');
    const btnMail = document.getElementById('btn-header-mail');
    const btnDrive = document.getElementById('btn-header-drive');

    if (btnSearch) btnSearch.onclick = () => openGlobalSearch();
    if (btnBell) btnBell.onclick = () => alert('Notificações: Nenhuma notificação recente.');
    if (btnMultiHeader) btnMultiHeader.onclick = () => openMultiScreenMode();
    if (btnMail) btnMail.onclick = () => alert('Mensagens: Sem novas mensagens do servidor.');
    if (btnDrive) btnDrive.onclick = () => alert('Listas e Gravações: Recurso de gravação indisponível no momento.');

    const btnAccount = document.getElementById('btn-foot-account');
    const btnMultiFoot = document.getElementById('btn-foot-multi');
    const btnCatchup = document.getElementById('btn-foot-catchup');
    const btnFavorites = document.getElementById('btn-foot-favorites');
    const btnRadio = document.getElementById('btn-foot-radio');
    const btnConfig = document.getElementById('btn-foot-config');

    if (btnAccount) btnAccount.onclick = () => openAccountInfo();
    if (btnMultiFoot) btnMultiFoot.onclick = () => openMultiScreenMode();
    if (btnCatchup) btnCatchup.onclick = () => alert('Catch Up: Selecione um canal ao vivo com suporte a programação gravada.');
    if (btnFavorites) btnFavorites.onclick = () => loadFavorites();
    if (btnRadio) btnRadio.onclick = () => loadCategories('radio');
    if (btnConfig) btnConfig.onclick = () => openSettingsModal();
}

function openGlobalSearch() {
    loadCategories('live');
    setTimeout(() => {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.focus();
    }, 300);
}

function openAccountInfo() {
    alert(`Informações da Conta:\nUtilizador: ${globalUsername || 'Desconectado'}\nStatus: Ativo`);
}

function openMultiScreenMode() {
    alert('Modo Multitela: Selecione até 4 canais em simultâneo na área do leitor.');
}

function openSettingsModal() {
    alert('Configurações: Definições de Reprodutor, Proxy e Formato de Transmissão.');
}

function loadFavorites() {
    if (favoritesList.length === 0) {
        alert('Favoritos: Nenhum item adicionado aos favoritos.');
        return;
    }
    showScreen('player-screen');
    renderStreamGrid(favoritesList);
}

// Manipulação do Formulário de Login
const authForm = document.getElementById('auth-form');
if (authForm) {
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');

        globalUsername = usernameInput ? usernameInput.value.trim() : '';
        globalPassword = passwordInput ? passwordInput.value.trim() : '';

        if (!globalUsername || !globalPassword) {
            alert('Por favor, preencha o utilizador e a palavra-passe.');
            return;
        }

        const authenticated = await authenticateUser(globalUsername, globalPassword);
        if (authenticated) {
            showScreen('dashboard-screen');
        } else {
            alert('Falha na autenticação. Verifique os seus dados.');
        }
    });
}

// Gestão de Ecrãs
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.add('active');
    }
}

function showDashboard() {
    showScreen('dashboard-screen');
}

function logout() {
    globalUsername = '';
    globalPassword = '';
    closePlayerModal();
    showScreen('login-screen');
}

// 1. Autenticação na API
async function authenticateUser(username, password) {
    const url = `${BASE_URL}?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(url));
        const data = await response.json();

        if (data && data.user_info && data.user_info.auth === 1) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error('[IPTV] Erro ao autenticar:', error);
        return false;
    }
}

// 2. Carregar Categorias
async function loadCategories(mode) {
    currentMode = mode;
    showScreen('player-screen');

    const sectionTitle = document.getElementById('section-title');
    if (sectionTitle) {
        sectionTitle.textContent = mode.toUpperCase();
    }

    let action = 'get_live_categories';
    if (mode === 'movies') action = 'get_vod_categories';
    if (mode === 'series') action = 'get_series_categories';

    const categorySelect = document.getElementById('category-select');
    if (categorySelect) {
        categorySelect.innerHTML = '<option value="">A carregar categorias...</option>';
    }

    const url = `${BASE_URL}?username=${encodeURIComponent(globalUsername)}&password=${encodeURIComponent(globalPassword)}&action=${action}`;

    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(url));
        const categories = await response.json();

        if (categorySelect) {
            categorySelect.innerHTML = '<option value="">Selecione uma categoria...</option>';

            if (Array.isArray(categories)) {
                categories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat.category_id;
                    option.textContent = cat.category_name;
                    categorySelect.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('[IPTV] Erro ao carregar categorias:', error);
    }
}

// Evento de alteração de categoria
const categorySelect = document.getElementById('category-select');
if (categorySelect) {
    categorySelect.addEventListener('change', (e) => {
        const categoryId = e.target.value;
        if (categoryId) {
            loadStreams(categoryId);
        } else {
            const contentGrid = document.getElementById('content-grid');
            if (contentGrid) contentGrid.innerHTML = '';
        }
    });
}

// 3. Carregar Conteúdos (Canais / Filmes / Séries)
async function loadStreams(categoryId) {
    const contentGrid = document.getElementById('content-grid');
    if (!contentGrid) return;

    let action = 'get_live_streams';
    if (currentMode === 'movies') action = 'get_vod_streams';
    if (currentMode === 'series') action = 'get_series';

    const url = `${BASE_URL}?username=${encodeURIComponent(globalUsername)}&password=${encodeURIComponent(globalPassword)}&action=${action}&category_id=${encodeURIComponent(categoryId)}`;

    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(url));
        const streams = await response.json();

        currentStreams = Array.isArray(streams) ? streams : [];
        renderStreamGrid(currentStreams);
    } catch (error) {
        console.error('[IPTV] Erro ao carregar streams:', error);
    }
}

// Renderizar Grade de Capas na Área Central
function renderStreamGrid(streams) {
    const contentGrid = document.getElementById('content-grid');
    if (!contentGrid) return;

    contentGrid.innerHTML = '';

    streams.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'media-card';

        let posterUrl = item.stream_icon || item.cover || 'logo.png';
        
        const img = document.createElement('img');
        img.className = 'media-poster';
        img.src = posterUrl;
        img.alt = item.name || 'Capa';
        img.onerror = () => { img.src = 'logo.png'; };

        const title = document.createElement('span');
        title.textContent = item.name;

        card.appendChild(img);
        card.appendChild(title);

        card.addEventListener('click', () => {
            document.querySelectorAll('.media-card').forEach(el => el.classList.remove('active'));
            card.classList.add('active');

            if (currentMode === 'series') {
                openSeriesDetails(item.series_id, item.name);
            } else {
                currentPlaylist = streams.map(s => ({
                    id: s.stream_id,
                    title: s.name,
                    extension: s.container_extension || 'mp4'
                }));
                currentIndex = index;
                playCurrentIndex();
            }
        });

        contentGrid.appendChild(card);
    });
}

// Filtro de Pesquisa em Tempo Real
const searchInput = document.getElementById('search-input');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = currentStreams.filter(item => 
            item.name && item.name.toLowerCase().includes(term)
        );
        renderStreamGrid(filtered);
    });
}

// 4. Gestão de Séries (Temporadas e Episódios)
async function openSeriesDetails(seriesId, seriesTitle) {
    const modalTitle = document.getElementById('modal-series-title');
    if (modalTitle) modalTitle.textContent = seriesTitle;

    const url = `${BASE_URL}?username=${encodeURIComponent(globalUsername)}&password=${encodeURIComponent(globalPassword)}&action=get_series_info&series_id=${encodeURIComponent(seriesId)}`;

    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(url));
        const data = await response.json();

        if (data && data.episodes) {
            seriesEpisodesData = data.episodes;
            setupSeasonSelector(data.episodes);
            document.getElementById('series-modal').classList.add('active');
        } else {
            alert('Não foram encontrados episódios para esta série.');
        }
    } catch (error) {
        console.error('[IPTV] Erro ao carregar informações da série:', error);
    }
}

function setupSeasonSelector(episodes) {
    const seasonSelect = document.getElementById('season-select');
    if (!seasonSelect) return;

    seasonSelect.innerHTML = '';
    const seasons = Object.keys(episodes);

    seasons.forEach(seasonNum => {
        const option = document.createElement('option');
        option.value = seasonNum;
        option.textContent = `Temporada ${seasonNum}`;
        seasonSelect.appendChild(option);
    });

    seasonSelect.onchange = (e) => {
        renderEpisodesList(episodes[e.target.value]);
    };

    if (seasons.length > 0) {
        renderEpisodesList(episodes[seasons[0]]);
    }
}

function renderEpisodesList(episodes) {
    const episodesList = document.getElementById('episodes-list');
    if (!episodesList) return;

    episodesList.innerHTML = '';

    currentPlaylist = episodes.map(ep => ({
        id: ep.id,
        title: ep.title,
        extension: ep.container_extension || 'mp4',
        mode: 'series'
    }));

    episodes.forEach((ep, idx) => {
        const item = document.createElement('div');
        item.className = 'episode-item';
        item.innerHTML = `<span>EP ${ep.episode_num} - ${ep.title}</span> <i data-lucide="play-circle"></i>`;

        item.addEventListener('click', () => {
            currentIndex = idx;
            closeSeriesModal();
            playCurrentIndex();
        });

        episodesList.appendChild(item);
    });

    if (window.lucide) lucide.createIcons();
}

function closeSeriesModal() {
    const modal = document.getElementById('series-modal');
    if (modal) modal.classList.remove('active');
}

// 5. Controlo de Reprodução e Leitor
function playCurrentIndex() {
    if (currentIndex < 0 || currentIndex >= currentPlaylist.length) return;

    const currentItem = currentPlaylist[currentIndex];
    const currentTitle = document.getElementById('current-title');
    if (currentTitle) currentTitle.textContent = currentItem.title;

    let rawStreamUrl = '';

    if (currentMode === 'live') {
        // Padrão de transmissão ao vivo (TS/MPEG-TS)
        rawStreamUrl = `${STREAM_BASE_URL}/${globalUsername}/${globalPassword}/${currentItem.id}.ts`;
    } else if (currentMode === 'movies') {
        rawStreamUrl = `https://nivok.xyz/movie/${globalUsername}/${globalPassword}/${currentItem.id}.${currentItem.extension}`;
    } else if (currentMode === 'series' || currentItem.mode === 'series') {
        rawStreamUrl = `https://nivok.xyz/series/${globalUsername}/${globalPassword}/${currentItem.id}.${currentItem.extension}`;
    }

    playMediaUrl(rawStreamUrl);
}

function playNextItem() {
    if (currentIndex + 1 < currentPlaylist.length) {
        currentIndex++;
        playCurrentIndex();
    } else {
        console.log('[IPTV] Fim da lista de reprodução.');
    }
}

function playMediaUrl(rawStreamUrl) {
    const videoPlayer = document.getElementById('video-player');
    const playerModal = document.getElementById('player-modal');
    if (!videoPlayer) return;

    if (playerModal) {
        playerModal.classList.add('active');
    }

    // Limpa a instância anterior do HLS
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    const proxiedStreamUrl = PROXY_URL + encodeURIComponent(rawStreamUrl);

    // Se for transmissão HLS (.m3u8)
    if (rawStreamUrl.includes('.m3u8') && Hls.isSupported()) {
        hlsInstance = new Hls({
            xhrSetup: function (xhr, url) {
                if (!url.startsWith(PROXY_URL)) {
                    xhr.open('GET', PROXY_URL + encodeURIComponent(url), true);
                }
            }
        });

        hlsInstance.loadSource(proxiedStreamUrl);
        hlsInstance.attachMedia(videoPlayer);

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            videoPlayer.play().catch(e => console.warn('[IPTV] Autoplay bloqueado pelo navegador:', e));
        });

        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.error('[IPTV] Erro do HLS:', data);
                videoPlayer.src = proxiedStreamUrl;
                videoPlayer.play().catch(() => {});
            }
        });
    } else {
        // Transmissões de canais brutos (.ts) ou filmes/séries (.mp4 / .mkv)
        videoPlayer.src = proxiedStreamUrl;
        videoPlayer.play().catch(e => console.warn('[IPTV] Reprodução direta bloqueada:', e));
    }
}

function closePlayerModal() {
    const playerModal = document.getElementById('player-modal');
    const videoPlayer = document.getElementById('video-player');

    if (playerModal) {
        playerModal.classList.remove('active');
    }

    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.src = '';
    }

    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
}