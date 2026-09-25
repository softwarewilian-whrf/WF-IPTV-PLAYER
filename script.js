// Configuração da API e Proxy
const BASE_URL = 'https://nivok.xyz/player_api.php';
const STREAM_BASE_URL = 'https://nivok.xyz/live';
const PROXY_URL = 'https://rapid-voice-4ddf.softwarewilian.workers.dev/?url=';

// Variáveis globais
let globalUsername = '';
let globalPassword = '';
let hlsInstance = null;

// Elementos do DOM
const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const categorySelect = document.getElementById('category-select');
const streamList = document.getElementById('stream-list');
const videoPlayer = document.getElementById('video-player');

console.log('[IPTV] Aplicação iniciada.');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        globalUsername = usernameInput ? usernameInput.value.trim() : '';
        globalPassword = passwordInput ? passwordInput.value.trim() : '';

        if (!globalUsername || !globalPassword) {
            alert('Por favor, preencha o utilizador e a palavra-passe.');
            return;
        }

        const authenticated = await authenticateUser(globalUsername, globalPassword);
        if (authenticated) {
            if (loginSection) loginSection.style.display = 'none';
            if (appSection) appSection.style.display = 'block';
            await loadCategories();
        } else {
            alert('Falha na autenticação. Verifique os seus dados.');
        }
    });
}

// 1. Autenticação na API
async function authenticateUser(username, password) {
    const url = `${BASE_URL}?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    console.log('[IPTV] Requisição: Autenticação');
    console.log('[IPTV] URL:', url);

    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(url));
        const data = await response.json();

        if (data && data.user_info && data.user_info.auth === 1) {
            console.log('[IPTV] Login realizado com sucesso.');
            return true;
        } else {
            console.warn('[IPTV] Resposta de autenticação inválida:', data);
            return false;
        }
    } catch (error) {
        console.error('[IPTV] Erro ao autenticar:', error);
        return false;
    }
}

// 2. Carregar Categorias
async function loadCategories() {
    if (!categorySelect) return;
    const url = `${BASE_URL}?username=${encodeURIComponent(globalUsername)}&password=${encodeURIComponent(globalPassword)}&action=get_live_categories`;
    
    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(url));
        const categories = await response.json();

        categorySelect.innerHTML = '<option value="">Selecione uma categoria...</option>';

        if (Array.isArray(categories)) {
            categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.category_id;
                option.textContent = cat.category_name;
                categorySelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('[IPTV] Erro ao carregar categorias:', error);
    }
}

if (categorySelect) {
    categorySelect.addEventListener('change', (e) => {
        const categoryId = e.target.value;
        if (categoryId) {
            loadStreams(categoryId);
        } else if (streamList) {
            streamList.innerHTML = '';
        }
    });
}

// 3. Carregar Streams
async function loadStreams(categoryId) {
    if (!streamList) return;
    const url = `${BASE_URL}?username=${encodeURIComponent(globalUsername)}&password=${encodeURIComponent(globalPassword)}&action=get_live_streams&category_id=${encodeURIComponent(categoryId)}`;

    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(url));
        const streams = await response.json();

        streamList.innerHTML = '';

        if (Array.isArray(streams)) {
            streams.forEach(stream => {
                const li = document.createElement('li');
                li.textContent = stream.name;
                li.className = 'stream-item';
                li.addEventListener('click', () => {
                    playStream(stream.stream_id);
                });
                streamList.appendChild(li);
            });
        }
    } catch (error) {
        console.error('[IPTV] Erro ao carregar streams:', error);
    }
}

// 4. Reproduzir Stream
function playStream(streamId) {
    if (!videoPlayer) return;
    const rawStreamUrl = `${STREAM_BASE_URL}/${globalUsername}/${globalPassword}/${streamId}.m3u8`;
    const proxiedStreamUrl = PROXY_URL + encodeURIComponent(rawStreamUrl);

    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    if (Hls.isSupported()) {
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
            videoPlayer.play().catch(e => console.warn('[IPTV] Reprodução bloqueada:', e));
        });
    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        videoPlayer.src = proxiedStreamUrl;
        videoPlayer.play();
    }
}