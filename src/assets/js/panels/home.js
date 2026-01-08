/**
 * @author Darken
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup } from '../utils.js'

const { Launch } = require('minecraft-java-core')
const { shell, ipcRenderer } = require('electron')

class Home {
    static id = "home";

    async init(config) {
        try {
            this.config = config;
            this.db = new database();
            this.isStarting = false;
            
            console.log('Home: Initializing...');
            
            const settingsBtn = document.querySelector('.settings-btn-icon');
            if (settingsBtn) {
                settingsBtn.addEventListener('click', e => changePanel('settings'));
                console.log('Home: Settings button listener added');
            } else {
                console.warn('Home: settings-btn-icon not found');
            }
            
            const instanceBtn = document.querySelector('.instance-select-icon');
            if (instanceBtn) {
                instanceBtn.addEventListener('click', e => changePanel('instances'));
                console.log('Home: Instance button listener added');
            } else {
                console.warn('Home: instance-select-icon not found');
            }
            
            const playBtn = document.querySelector('.play-btn');
            if (playBtn) {
                playBtn.addEventListener('click', () => this.startGame());
                console.log('Home: Play button listener added');
            } else {
                console.warn('Home: play-btn not found');
            }
            
            await this.setupInitialInstance();
            
            console.log('Home panel initialized successfully');
        } catch (err) {
            console.error('Error initializing Home panel:', err);
            console.error('Stack:', err.stack);
        }
    }
    
    async setupInitialInstance() {
        try {
            let configClient = await this.db.readData('configClient');
            let auth = await this.db.readData('accounts', configClient.account_selected);
            
            if (!configClient || !auth) {
                console.log('No config client or auth, skipping instance setup');
                return;
            }
            
            let allInstances = await config.getInstanceList();
            let instancesList = await this.filterAuthorizedInstances(allInstances, auth?.name);
            
            let instanceSelect = instancesList.find(i => i.name == configClient?.instance_selct)
                ? configClient?.instance_selct
                : null;

            if (!instanceSelect && instancesList.length > 0) {
                configClient.instance_selct = instancesList[0]?.name;
                instanceSelect = instancesList[0]?.name;
                await this.db.updateData('configClient', configClient);
                console.log('Set default instance to:', instanceSelect);
            }

            for (let instance of instancesList) {
                if (instance.name === instanceSelect) {
                    try { setStatus(instance.status); } catch (e) { }
                    try { this.setBackground(instance.backgroundUrl || instance.background || null); } catch (e) { }
                    break;
                }
            }
        } catch (err) {
            console.warn('Error setting up initial instance:', err);
        }
    }

    async filterAuthorizedInstances(instancesList, authName) {
        let unlockedData = {};
        try {
            unlockedData = await this.db.readData('unlockedInstances') || {};
            console.log('filterAuthorizedInstances: unlockedData from DB =', JSON.stringify(unlockedData));
        } catch (e) {
            console.warn('Error reading unlocked instances from DB:', e);
        }

        let needsUpdate = false;
        for (let instanceName in unlockedData) {
            const unlockedInfo = unlockedData[instanceName];
            const savedCode = typeof unlockedInfo === 'object' ? unlockedInfo.code : null;
            
            const currentInstance = instancesList.find(i => i.name === instanceName);
            if (currentInstance && currentInstance.password) {
                if (!savedCode || savedCode !== currentInstance.password) {
                    const reason = !savedCode ? 'no code stored' : 'code mismatch';
                    console.log(`🔄 ${reason} for "${instanceName}" - clearing unlock`);
                    delete unlockedData[instanceName];
                    needsUpdate = true;
                }
            } else {
                if (currentInstance && !currentInstance.password) {
                    console.log(`🔄 Password removed from "${instanceName}" - clearing unlock`);
                    delete unlockedData[instanceName];
                    needsUpdate = true;
                }
            }
        }

        if (needsUpdate) {
            try {
                const dataToSave = { ...unlockedData };
                delete dataToSave.ID;
                await this.db.updateData('unlockedInstances', dataToSave);
                console.log('✅ Cleaned up expired unlocks');
            } catch (e) {
                console.warn('Error updating unlocks:', e);
            }
        }

        const unlockedInstances = Object.keys(unlockedData).filter(key => {
            const info = unlockedData[key];
            return info === true || (typeof info === 'object' && info !== null);
        });

        const filtered = instancesList.filter(instance => {
            if (instance.password) {
                const isUnlocked = unlockedInstances.includes(instance.name);
                console.log(`Instance "${instance.name}" has password, unlocked=${isUnlocked}`);
                return isUnlocked;
            }

            if (instance.whitelistActive) {
                const wl = Array.isArray(instance.whitelist) ? instance.whitelist : [];
                const unlockInfo = unlockedData[instance.name];
                const unlockedUsers = (unlockInfo && Array.isArray(unlockInfo.users)) ? unlockInfo.users : [];
                
                const isAuthorized = wl.includes(authName) || unlockedUsers.includes(authName);
                console.log(`Instance "${instance.name}" has whitelist=[${wl.join(', ')}], unlockedUsers=[${unlockedUsers.join(', ')}], authName=${authName}, authorized=${isAuthorized}`);
                return isAuthorized;
            }

            return true;
        });
        
        console.log('filterAuthorizedInstances: total instances in =', instancesList.length, 'filtered out =', filtered.length);
        return filtered;
    }

    setBackground(url) {
        try {
            if (!url) {
                document.body.style.backgroundImage = '';
                this.currentBackground = null;
                return;
            }

            const img = new Image();
            img.onload = () => {
                document.body.style.backgroundImage = `url('${url}')`;
                this.currentBackground = url;
            };
            img.onerror = () => {
                console.warn('No se pudo cargar la imagen de fondo:', url);
                document.body.style.backgroundImage = '';
                this.currentBackground = null;
            };
            img.src = url;
        } catch (e) {
            console.warn('Error estableciendo fondo:', e);
            document.body.style.backgroundImage = '';
        }
    }

    async startGame() {
        if (this.isStarting) return;
        const rawConfig = await this.db.readData('configClient');
        let configClient = rawConfig || {};
        let needPersist = false;

        if (!rawConfig || typeof rawConfig !== 'object') {
            needPersist = true;
            configClient = {
                account_selected: null,
                instance_selct: null,
                java_config: { java_path: null, java_memory: { min: 2, max: 4 } },
                game_config: { screen_size: { width: 854, height: 480 } },
                launcher_config: { download_multi: 5, theme: 'auto', closeLauncher: 'close-launcher', intelEnabledMac: true }
            };
        }

        if (!configClient.launcher_config) { configClient.launcher_config = { download_multi: 5, theme: 'auto', closeLauncher: 'close-launcher', intelEnabledMac: true }; needPersist = true; }
        if (!configClient.java_config) { configClient.java_config = { java_path: null, java_memory: { min: 2, max: 4 } }; needPersist = true; }
        if (!configClient.java_config.java_memory) { configClient.java_config.java_memory = { min: 2, max: 4 }; needPersist = true; }
        if (!configClient.game_config) { configClient.game_config = { screen_size: { width: 854, height: 480 } }; needPersist = true; }
        if (!configClient.game_config.screen_size) { configClient.game_config.screen_size = { width: 854, height: 480 }; needPersist = true; }
        if (needPersist) {
            try { await this.db.updateData('configClient', configClient); } catch (err) { console.warn('Failed to persist default configClient:', err); }
        }
        const instances = await config.getInstanceList();
        const authenticator = await this.db.readData('accounts', configClient.account_selected);

        if (!configClient.instance_selct) {
            new popup().openPopup({ title: 'Selecciona una instancia', content: 'Debes elegir una instancia antes de jugar.', color: 'red', options: true });
            return;
        }

        const authorizedInstances = await this.filterAuthorizedInstances(instances, authenticator?.name);
        const options = authorizedInstances.find(i => i.name === configClient.instance_selct);

        const playInstanceBTN = document.querySelector('.play-instance');
        const playBtn = document.querySelector('.play-btn');
        const setPlayActivity = (active) => {
            if (!playInstanceBTN) return;
            playInstanceBTN.classList.toggle('starting-active', active);
        };
        const setPlayEnabled = (enabled) => {
            if (!playBtn) return;
            playBtn.disabled = !enabled;
            playBtn.classList.toggle('disabled', !enabled);
        };
        const infoStartingBOX = document.querySelector('.info-starting-game');
        const infoStarting = document.querySelector(".info-starting-game-text");
        const progressBar = document.querySelector('.progress-bar');

        if (!options) {
            console.error('startGame: no options found for selected/authorized instance', configClient.instance_selct);
            new popup().openPopup({ title: 'Selecciona una instancia', content: 'La instancia no está disponible o no tienes acceso.', color: 'red', options: true });
            return;
        }

        if (!authenticator) {
            console.error('startGame: no authenticator/account selected');
            new popup().openPopup({ title: 'Error', content: 'No hay una cuenta seleccionada. Inicie sesión primero.', color: 'red', options: true });
            return;
        }

        if (options.whitelistActive) {
            const wl = Array.isArray(options.whitelist) ? options.whitelist : [];
            if (!wl.includes(authenticator?.name)) {
                console.error('startGame: Usuario no autorizado para lanzar instancia', configClient.instance_selct, 'usuario:', authenticator?.name);
                new popup().openPopup({ title: 'Acceso denegado', content: `No tienes permiso para lanzar la instancia ${options.name}.`, color: 'red', options: true });
                return;
            }
        }

        this.isStarting = true;
        setPlayEnabled(false);

        if (!options.loadder || typeof options.loadder !== 'object') {
            console.warn('startGame: instance loader info missing or invalid, attempting to continue with defaults', options.name);
        }

        const opt = {
            url: options.url,
            authenticator,
            timeout: 10000,
            path: `${await appdata()}/${process.platform === 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
            instance: options.name,
            version: options.loadder?.minecraft_version,
            detached: configClient.launcher_config.closeLauncher !== "close-all",
            downloadFileMultiple: configClient.launcher_config.download_multi,
            intelEnabledMac: configClient.launcher_config.intelEnabledMac,
            loader: {
                type: options.loadder?.loadder_type,
                build: options.loadder?.loadder_version,
                enable: options.loadder?.loadder_type !== 'none'
            },
            verify: options.verify,
            ignored: Array.isArray(options.ignored) ? [...options.ignored] : [],
            javaPath: configClient.java_config?.java_path,
            screen: {
                width: configClient.game_config?.screen_size?.width,
                height: configClient.game_config?.screen_size?.height
            },
            memory: {
                min: `${configClient.java_config.java_memory.min * 1024}M`,
                max: `${configClient.java_config.java_memory.max * 1024}M`
            }
        };

        const launch = new Launch();

        launch.on('extract', () => ipcRenderer.send('main-window-progress-load'));
        launch.on('progress', (progress, size) => {
            infoStarting.innerHTML = `Descargando ${((progress / size) * 100).toFixed(0)}%`;
            ipcRenderer.send('main-window-progress', { progress, size });
            if (progressBar) {
                progressBar.value = progress;
                progressBar.max = size;
            }
        });
        launch.on('check', (progress, size) => {
            infoStarting.innerHTML = `Verificando ${((progress / size) * 100).toFixed(0)}%`;
            ipcRenderer.send('main-window-progress', { progress, size });
            if (progressBar) {
                progressBar.value = progress;
                progressBar.max = size;
            }
        });
        launch.on('estimated', time => console.log(`Tiempo estimado: ${time}s`));
        launch.on('speed', speed => console.log(`${(speed / 1067008).toFixed(2)} Mb/s`));
        launch.on('patch', () => { if (infoStarting) infoStarting.innerHTML = `Parche en curso...`; });
        launch.on('data', () => {
            if (progressBar) progressBar.style.display = "none";
            if (infoStarting) infoStarting.innerHTML = `Jugando...`;
            new logger('Minecraft', '#36b030');
        });
        launch.on('close', code => {
            ipcRenderer.send('main-window-progress-reset');
            if (infoStartingBOX) infoStartingBOX.style.display = "none";
            setPlayActivity(false);
            setPlayEnabled(true);
            this.isStarting = false;
            if (infoStarting) infoStarting.innerHTML = `Verificando`;
            new logger(pkg.name, '#7289da');
        });
        launch.on('error', err => {
            let popupError = new popup();
            popupError.openPopup({ title: 'Error', content: err?.error || err?.message || String(err), color: 'red', options: true });
            ipcRenderer.send('main-window-progress-reset');
            if (infoStartingBOX) infoStartingBOX.style.display = "none";
            setPlayActivity(false);
            setPlayEnabled(true);
            this.isStarting = false;
            if (infoStarting) infoStarting.innerHTML = `Verificando`;
            new logger(pkg.name, '#7289da');
        });

        setPlayActivity(true);
        if (infoStartingBOX) infoStartingBOX.style.display = "block";
        if (progressBar) progressBar.style.display = "";
        ipcRenderer.send('main-window-progress-load');

        try {
            const startImg = document.querySelector('.starting-icon-big');
            if (startImg) {
                const avatar = options.avatarUrl || options.avatar || options.iconUrl || options.icon || options.backgroundUrl || options.background;
                startImg.src = avatar || 'assets/images/icon.png';
            }
        } catch (err) { console.warn('Failed to set starting image:', err); }

        try {
            console.log('Calling launch.Launch with opt:', opt);
            const maybePromise = launch.Launch(opt);
            if (maybePromise && typeof maybePromise.then === 'function') {
                await maybePromise.catch(launchErr => { throw launchErr; });
            }
            console.log('launch.Launch invoked successfully');
        } catch (launchErr) {
            console.error('launch.Launch threw an exception:', launchErr);
            let popupError = new popup();
            popupError.openPopup({ title: 'Error al lanzar', content: launchErr?.message || String(launchErr), color: 'red', options: true });
            ipcRenderer.send('main-window-progress-reset');
            if (infoStartingBOX) infoStartingBOX.style.display = "none";
            setPlayActivity(false);
            setPlayEnabled(true);
            this.isStarting = false;
            return;
        }
    }
}

export default Home;
