/**
 * @author Darken
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
import { config, database, changePanel, setStatus, Notification } from '../utils.js'
const { ipcRenderer } = require('electron')

class Instances {
    static id = "instances";

    async init(config) {
        try {
            this.config = config;
            this.db = new database();
            this.currentFilter = '';
            this.lastWhitelistState = null;
            this.setupEventListeners();
            await this.loadInstances();
            this.setupCodeInput();
            this.startWhitelistWatcher();
        } catch (err) {
            console.error('Error initializing Instances panel:', err);
        }
    }

    setupEventListeners() {
        try {
            const closeBtn = document.querySelector('.instances-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => changePanel('home'));
            } else {
                console.warn('instances-close-btn not found');
            }

            const searchInput = document.querySelector('#instances-search');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.currentFilter = e.target.value.toLowerCase();
                    this.filterAndRenderInstances();
                });

                setTimeout(() => searchInput.focus(), 100);
            } else {
                console.warn('instances-search not found');
            }
        } catch (err) {
            console.error('Error setting up event listeners:', err);
        }
    }

    async loadInstances() {
        try {
            let configClient = await this.db.readData('configClient');
            let auth = await this.db.readData('accounts', configClient.account_selected);
            let instancesList = await config.getInstanceList();

            let unlockedData = {};
            try {
                unlockedData = await this.db.readData('unlockedInstances') || {};
            } catch (e) {
                console.warn('Error reading unlocked instances from DB:', e);
            }

            this.allInstances = [];
            this.selectedInstance = configClient?.instance_selct;

            for (let instance of instancesList) {
                let locked = false;
                
                if (instance.password) {
                    const isUnlocked = unlockedData[instance.name] === true || (typeof unlockedData[instance.name] === 'object' && unlockedData[instance.name] !== null);
                    locked = !isUnlocked;
                } else if (instance.whitelistActive) {
                    const whitelist = Array.isArray(instance.whitelist) ? instance.whitelist : [];
                    const unlockInfo = unlockedData[instance.name];
                    const unlockedUsers = (unlockInfo && Array.isArray(unlockInfo.users)) ? unlockInfo.users : [];
                    
                    locked = !whitelist.includes(auth?.name) && !unlockedUsers.includes(auth?.name);
                }

                instance.locked = locked;
                if (locked) continue;
                this.allInstances.push(instance);
            }

            if (this.selectedInstance && !this.allInstances.find(i => i.name === this.selectedInstance)) {
                this.selectedInstance = null;
                configClient.instance_selct = null;
                await this.db.updateData('configClient', configClient);
                document.body.style.backgroundImage = '';
            }

            this.filterAndRenderInstances();
        } catch (err) {
            console.error('Error loading instances:', err);
            const grid = document.querySelector('#instances-grid');
            if (grid) {
                grid.innerHTML = '<div class="error-message">Error al cargar instancias</div>';
            }
        }
    }

    filterAndRenderInstances() {
        let filteredInstances = this.allInstances.filter(instance =>
            instance.name.toLowerCase().includes(this.currentFilter)
        );

        const grid = document.querySelector('#instances-grid');
        const emptyMsg = document.querySelector('#instances-empty');

        if (filteredInstances.length === 0) {
            grid.innerHTML = '';
            emptyMsg.style.display = 'block';
            document.body.style.backgroundImage = '';
        } else {
            emptyMsg.style.display = 'none';
            grid.innerHTML = '';

            for (let instance of filteredInstances) {
                const bg = instance.backgroundUrl || instance.background || '';

                const card = document.createElement('div');
                card.className = `instance-card-large${instance.name === this.selectedInstance ? ' selected' : ''}${instance.locked ? ' locked' : ''}`;
                card.dataset.name = instance.name;
                card.dataset.bg = bg;

                const backgroundStyle = bg ? `background-image: url('${bg}')` : '';

                card.innerHTML = `
                    <div class="instance-card-bg" style="${backgroundStyle}">
                        <div class="instance-card-overlay">
                            <h3 class="instance-card-name">${instance.name}</h3>
                            ${instance.name === this.selectedInstance ? '<div class="instance-card-badge">Seleccionada</div>' : ''}
                            ${instance.locked ? '<div class="instance-card-lock-badge">BLOQUEADO</div>' : ''}
                        </div>
                    </div>
                `;

                card.addEventListener('click', async () => {
                    if (instance.locked) {
                        const openBtn = document.getElementById('open-codigo-btn');
                        if (openBtn) {
                            openBtn.click();
                            const codigoInput = document.getElementById('codigo-instance');
                            if (codigoInput) {
                                // Potentially pre-fill or just focus
                                codigoInput.placeholder = `Código para ${instance.name}...`;
                            }
                        }
                        return;
                    }
                    await this.selectInstance(instance);
                });
                card.addEventListener('mouseenter', () => this.previewBackground(bg));
                card.addEventListener('mouseleave', () => this.restoreBackground());

                grid.appendChild(card);
            }
        }
    }

    async selectInstance(instance) {
        if (instance.locked) return;
        try {
            let configClient = await this.db.readData('configClient');
            configClient.instance_selct = instance.name;
            await this.db.updateData('configClient', configClient);

            this.selectedInstance = instance.name;
            this.filterAndRenderInstances();

            ipcRenderer.send('instance-changed', { instanceName: instance.name });

            try { setStatus(instance.status); } catch (e) { }

            document.dispatchEvent(new CustomEvent('instance-selected', { detail: { instance: instance } }));

            const toast = document.createElement('div');
            toast.textContent = '✔ Instancia seleccionada';
            toast.style.position = 'fixed';
            toast.style.bottom = '25px';
            toast.style.right = '25px';
            toast.style.background = 'rgba(60, 179, 113, 0.9)';
            toast.style.color = 'white';
            toast.style.padding = '10px 16px';
            toast.style.borderRadius = '8px';
            toast.style.fontFamily = 'sans-serif';
            toast.style.fontSize = '14px';
            toast.style.zIndex = '9999';
            toast.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
            toast.style.transition = 'opacity 0.5s ease';

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 500);
            }, 1500);

            setTimeout(() => changePanel('home'), 1000);
        } catch (err) {
            console.error('Error selecting instance:', err);

            const toast = document.createElement('div');
            toast.textContent = '❌ Error al seleccionar instancia';
            toast.style.position = 'fixed';
            toast.style.bottom = '25px';
            toast.style.right = '25px';
            toast.style.background = 'rgba(220, 53, 69, 0.9)';
            toast.style.color = 'white';
            toast.style.padding = '10px 16px';
            toast.style.borderRadius = '8px';
            toast.style.fontFamily = 'sans-serif';
            toast.style.fontSize = '14px';
            toast.style.zIndex = '9999';
            toast.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
            toast.style.transition = 'opacity 0.5s ease';

            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 500);
            }, 1500);
        }
    }

    previewBackground(bg) {
        if (bg) {
            try {
                document.body.style.backgroundImage = `url('${bg}')`;
            } catch (e) { }
        }
    }

    async restoreBackground() {
        try {
            if (this.selectedInstance) {
                const instance = this.allInstances.find(i => i.name === this.selectedInstance);
                if (instance) {
                    const bg = instance.backgroundUrl || instance.background;
                    if (bg) {
                        document.body.style.backgroundImage = `url('${bg}')`;
                    }
                } else {
                    document.body.style.backgroundImage = '';
                }
            } else {
                document.body.style.backgroundImage = '';
            }
        } catch (e) { }
    }

    async setupCodeInput() {
        try {
            const codigoInput = document.getElementById('codigo-instance');
            const enviarBtn = document.getElementById('enviar-codigo');
            const cancelarBtn = document.getElementById('cancelar-codigo');
            const openBtn = document.getElementById('open-codigo-btn');
            const container = document.getElementById('codigo-instance-container');
            const messageDiv = document.getElementById('codigo-message');

            if (!codigoInput || !enviarBtn) {
                console.warn('Code input elements not found in DOM');
                return;
            }

        const closeModal = () => {
            container.classList.remove('open');
            messageDiv.textContent = '';
            messageDiv.className = 'codigo-message';
            codigoInput.value = '';
        };

        openBtn?.addEventListener('click', () => {
            container.classList.add('open');
            codigoInput.focus();
        });

        cancelarBtn?.addEventListener('click', closeModal);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && container.classList.contains('open')) {
                container.classList.remove('open');
            }
        });

        const notifier = new Notification();
        const toastColors = {
            success: 'rgba(60, 179, 113, 0.95)',
            error: 'rgba(220, 53, 69, 0.95)',
            warning: 'rgba(245, 158, 11, 0.95)',
            info: 'rgba(59, 130, 246, 0.95)'
        };
        const toastTitles = {
            success: 'Éxito',
            error: 'Error',
            warning: 'Aviso',
            info: 'Información'
        };

        const showMessage = (text, type = 'info') => {
            if (messageDiv) {
                messageDiv.textContent = '';
                messageDiv.className = 'codigo-message';
            }

            notifier.openNotification({
                title: toastTitles[type] || 'Información',
                content: text,
                color: toastColors[type] || toastColors.info
            });
        };

        codigoInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                enviarBtn.click();
            }
        });

        enviarBtn.addEventListener('click', async () => {
            let codigo = codigoInput.value.trim();
            codigoInput.value = '';

            if (!codigo) {
                console.warn('Empty code submitted');
                showMessage('Ingresa un código', 'error', 2000);
                return;
            }

            if (!/^[A-Za-z0-9]+$/.test(codigo)) {
                console.warn('Invalid code format (contains special characters)');
                showMessage('El código contiene caracteres inválidos', 'error', 2000);
                return;
            }

            let configClient = await this.db.readData('configClient');

            if (!configClient.account_selected) {
                const allAccounts = await this.db.readAllData('accounts');
                if (allAccounts.length > 0) {
                    configClient.account_selected = allAccounts[0].ID;
                    await this.db.updateData('configClient', configClient);
                } else {
                    console.warn('No accounts available');
                    showMessage('No hay cuentas disponibles', 'error', 3000);
                    return;
                }
            }

            let cuenta = await this.db.readData('accounts', configClient.account_selected);
            let usuario = (cuenta && cuenta.name) || 'Invitado';

            console.log('Usuario detectado:', usuario);
            console.log('Código enviado:', codigo);

            showMessage('Validando código...', 'info', 1500);

            try {
                const response = await fetch(`http://ext2.bytte.cloud:10878/NeoHexaClient/api/validate.php`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        codigo: codigo,
                        usuario: usuario,
                    }),
                });

                const data = await response.json();
                console.info('Respuesta del servidor:', data);

                if (data.status === 'success') {
                    console.info('Acceso concedido a la instancia');
                    showMessage('✓ Acceso concedido correctamente', 'success', 2500);

                    setTimeout(async () => {
                        await this.loadInstances();
                        document.dispatchEvent(new Event('instances-updated'));
                    }, 100);
                } else if (data.status === 'error' && data.message === 'Ya tienes acceso a esta instancia') {
                    console.info('El usuario ya tiene esta instancia.');
                    showMessage('Ya tienes acceso a esta instancia', 'info', 2500);
                } else if (data.status === 'error') {
                    console.warn('Código inválido:', data.message);
                    showMessage(`Código inválido: ${data.message || 'Verifica el código e intenta de nuevo'}`, 'error', 3000);
                } else {
                    console.warn('Respuesta inesperada del servidor');
                    showMessage('Código inválido o no encontrado', 'error', 2500);
                }
            } catch (error) {
                console.error('Error en la petición:', error);
                showMessage('Error de conexión. Intenta de nuevo más tarde', 'error', 3000);
            }
        });
        } catch (err) {
            console.error('Error setting up code input:', err);
        }
    }

    startWhitelistWatcher() {
        setInterval(async () => {
            try {
                let configClient = await this.db.readData('configClient');
                let auth = await this.db.readData('accounts', configClient.account_selected);
                let instancesList = await config.getInstanceList();

                const whitelistHash = JSON.stringify(
                    instancesList.map(i => ({
                        name: i.name,
                        whitelistActive: i.whitelistActive,
                        whitelist: i.whitelist || []
                    }))
                );

                if (this.lastWhitelistState !== null && this.lastWhitelistState !== whitelistHash) {
                    console.log('Whitelist changes detected in instances panel, reloading...');
                    await this.loadInstances();
                    document.dispatchEvent(new CustomEvent('instances-updated'));
                }

                this.lastWhitelistState = whitelistHash;
            } catch (err) {
                console.warn('Error checking whitelist changes:', err);
            }
        }, 5000);
    }
}

export default Instances;
