const net = require('net');

/**
 * Clase que gestiona la conexión Telnet a un dispositivo OLT VSOL
 * Maneja el estado de la sesión, login, envío de comandos y detección de prompts
 */
class OltTelnetManager {
  constructor() {
    this.client = null;
    this.buffer = '';
    this.connected = false;
    this.loggedIn = false;
    this.inConfigMode = false;
    this.currentPrompt = '';
    this.waitingForResponse = false;
    this.responseResolver = null;
    this.enablePassword = '';
    this.lastCommand = '';
    this.connectionTimeout = 30000; // 30 segundos de timeout para conexión
  }

  /**
   * Establece una conexión Telnet con la OLT
   * @param {string} host - Dirección IP de la OLT
   * @param {number} port - Puerto Telnet (generalmente 23)
   * @param {string} username - Nombre de usuario para el login
   * @param {string} password - Contraseña para el login
   * @param {string} enablePassword - Contraseña para el modo privilegiado/configuración
   * @returns {Promise<void>} - Promesa que se resuelve cuando la conexión está establecida y el login es exitoso
   */
  connect(host, port, username, password, enablePassword) {
    return new Promise((resolve, reject) => {
      // Guardar la contraseña de habilitación para usarla más tarde
      this.enablePassword = enablePassword;
      
      // Crear un timeout para la conexión
      const connectionTimeoutId = setTimeout(() => {
        if (this.client) {
          this.client.destroy();
        }
        reject(new Error('Timeout de conexión'));
      }, this.connectionTimeout);
      
      // Crear el cliente Telnet usando el módulo net
      this.client = net.createConnection({
        host,
        port
      }, () => {
        console.log(`Conexión establecida a ${host}:${port}`);
        this.connected = true;
        clearTimeout(connectionTimeoutId);
      });

      // Configurar el encoding para manejar texto
      this.client.setEncoding('utf8');

      // Manejar datos recibidos
      this.client.on('data', (data) => {
        this.handleData(data, username, password, resolve, reject);
      });

      // Manejar errores
      this.client.on('error', (err) => {
        console.error('Error de conexión:', err);
        clearTimeout(connectionTimeoutId);
        this.connected = false;
        reject(err);
      });

      // Manejar cierre de conexión
      this.client.on('close', () => {
        console.log('Conexión cerrada');
        this.connected = false;
        this.loggedIn = false;
        this.inConfigMode = false;
      });
    });
  }

  /**
   * Procesa los datos recibidos del socket Telnet
   * @param {string} data - Datos recibidos
   * @param {string} username - Nombre de usuario para login
   * @param {string} password - Contraseña para login
   * @param {Function} resolve - Función para resolver la promesa de conexión
   * @param {Function} reject - Función para rechazar la promesa de conexión
   */
  handleData(data, username, password, resolve, reject) {
    // Añadir los datos recibidos al buffer
    this.buffer += data;
    
    console.log('Datos recibidos:', this.buffer);

    // Detectar prompts y responder adecuadamente
    if (!this.loggedIn) {
      // Proceso de login
      if (this.buffer.includes('Username:') || this.buffer.includes('Login:')) {
        console.log('Enviando nombre de usuario');
        this.client.write(username + '\n');
        this.buffer = '';
      } else if (this.buffer.includes('Password:')) {
        console.log('Enviando contraseña');
        this.client.write(password + '\n');
        this.buffer = '';
      } else if (this.detectLoginSuccess()) {
        console.log('Login exitoso');
        this.loggedIn = true;
        this.updateCurrentPrompt();
        resolve(); // Resolvemos la promesa de conexión
        this.buffer = '';
      } else if (this.detectLoginFailure()) {
        console.log('Fallo de autenticación');
        reject(new Error('Credenciales incorrectas'));
        this.buffer = '';
      }
    } else if (this.waitingForResponse) {
      // Estamos esperando respuesta a un comando
      if (this.detectCommandPrompt()) {
        // Extraer la respuesta del comando (excluyendo el comando enviado y el prompt final)
        const response = this.extractCommandResponse();
        
        // Actualizar el prompt actual
        this.updateCurrentPrompt();
        
        // Resolver la promesa pendiente con la respuesta
        if (this.responseResolver) {
          this.responseResolver(response);
          this.responseResolver = null;
        }
        
        this.waitingForResponse = false;
        this.buffer = '';
      } else if (this.buffer.includes('Password:')) {
        // Detectamos solicitud de contraseña después de 'configure terminal' o 'enable'
        if (this.lastCommand.includes('configure terminal') || this.lastCommand.includes('enable')) {
          console.log('Enviando contraseña de habilitación');
          this.client.write(this.enablePassword + '\n');
          this.buffer = '';
        }
      }
    }
  }

  /**
   * Detecta si el login fue exitoso basado en prompts típicos
   * @returns {boolean} - true si el login fue exitoso
   */
  detectLoginSuccess() {
    // Buscar prompts típicos que indican login exitoso
    const successPrompts = ['>', '#', '$'];
    return successPrompts.some(prompt => this.buffer.trim().endsWith(prompt));
  }

  /**
   * Detecta si el login falló basado en mensajes típicos
   * @returns {boolean} - true si el login falló
   */
  detectLoginFailure() {
    const failureMessages = [
      'Login incorrect',
      'Authentication failed',
      'Login failed',
      'Invalid username or password'
    ];
    return failureMessages.some(msg => this.buffer.includes(msg));
  }

  /**
   * Detecta si hemos recibido un prompt que indica que el comando ha finalizado
   * @returns {boolean} - true si se detectó un prompt de comando
   */
  detectCommandPrompt() {
    const prompts = ['>', '#', '(config)#', '(config-if)#'];
    return prompts.some(prompt => this.buffer.trim().endsWith(prompt));
  }

  /**
   * Extrae la respuesta de un comando del buffer
   * @returns {string} - La respuesta del comando
   */
  extractCommandResponse() {
    // Eliminar el comando enviado y el prompt final
    let response = this.buffer;
    
    // Eliminar el eco del comando enviado (primera línea)
    const commandEchoIndex = response.indexOf(this.lastCommand);
    if (commandEchoIndex !== -1) {
      const newlineAfterCommand = response.indexOf('\n', commandEchoIndex);
      if (newlineAfterCommand !== -1) {
        response = response.substring(newlineAfterCommand + 1);
      }
    }
    
    // Eliminar el prompt final
    const prompts = ['>', '#', '(config)#', '(config-if)#'];
    for (const prompt of prompts) {
      if (response.trim().endsWith(prompt)) {
        response = response.substring(0, response.lastIndexOf(prompt));
        break;
      }
    }
    
    return response.trim();
  }

  /**
   * Actualiza el prompt actual basado en el contenido del buffer
   */
  updateCurrentPrompt() {
    const buffer = this.buffer.trim();
    if (buffer.endsWith('#')) {
      this.currentPrompt = '#';
    } else if (buffer.endsWith('>')) {
      this.currentPrompt = '>';
    } else if (buffer.endsWith('(config)#')) {
      this.currentPrompt = '(config)#';
      this.inConfigMode = true;
    } else if (buffer.endsWith('(config-if)#')) {
      this.currentPrompt = '(config-if)#';
      this.inConfigMode = true;
    }
  }

  /**
   * Envía un comando a la OLT y espera por la respuesta
   * @param {string} command - Comando a enviar
   * @returns {Promise<string>} - Promesa que se resuelve con la respuesta al comando
   */
  sendCommand(command) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.loggedIn) {
        reject(new Error('No hay una sesión activa'));
        return;
      }

      // Guardar el comando actual
      this.lastCommand = command;
      
      // Configurar el estado para esperar respuesta
      this.waitingForResponse = true;
      this.responseResolver = resolve;
      this.buffer = '';
      
      // Enviar el comando
      console.log(`Enviando comando: ${command}`);
      this.client.write(command + '\n');
      
      // Establecer un timeout para la respuesta
      setTimeout(() => {
        if (this.waitingForResponse) {
          this.waitingForResponse = false;
          this.responseResolver = null;
          reject(new Error('Timeout esperando respuesta al comando'));
        }
      }, 30000); // 30 segundos de timeout
    });
  }

  /**
   * Entra en modo privilegiado (enable)
   * @returns {Promise<string>} - Promesa que se resuelve cuando se ha entrado en modo privilegiado
   */
  async enterEnableMode() {
    if (!this.connected || !this.loggedIn) {
      throw new Error('No hay una sesión activa');
    }
    
    if (this.currentPrompt === '#' || this.inConfigMode) {
      return 'Ya en modo privilegiado';
    }
    
    const response = await this.sendCommand('enable');
    return response;
  }

  /**
   * Entra en modo de configuración (configure terminal)
   * @returns {Promise<string>} - Promesa que se resuelve cuando se ha entrado en modo configuración
   */
  async enterConfigMode() {
    if (!this.connected || !this.loggedIn) {
      throw new Error('No hay una sesión activa');
    }
    
    if (this.inConfigMode) {
      return 'Ya en modo configuración';
    }
    
    // Si no estamos en modo privilegiado, primero entramos en él
    if (this.currentPrompt !== '#') {
      await this.enterEnableMode();
    }
    
    const response = await this.sendCommand('configure terminal');
    this.inConfigMode = true;
    return response;
  }

  /**
   * Cierra la conexión Telnet
   * @returns {Promise<void>} - Promesa que se resuelve cuando la conexión se ha cerrado
   */
  disconnect() {
    return new Promise((resolve) => {
      if (!this.connected) {
        resolve();
        return;
      }
      
      // Si estamos en modo configuración, salimos primero
      if (this.inConfigMode) {
        this.client.write('exit\n');
      }
      
      // Enviar comando de logout
      this.client.write('exit\n');
      
      // Cerrar la conexión
      this.client.end();
      
      // Limpiar el estado
      this.connected = false;
      this.loggedIn = false;
      this.inConfigMode = false;
      this.buffer = '';
      this.currentPrompt = '';
      
      resolve();
    });
  }

  /**
   * Obtiene el estado actual de la conexión
   * @returns {Object} - Objeto con el estado de la conexión
   */
  getStatus() {
    return {
      connected: this.connected,
      loggedIn: this.loggedIn,
      inConfigMode: this.inConfigMode,
      currentPrompt: this.currentPrompt
    };
  }

  /**
   * Verifica si la sesión está en modo configuración
   * @returns {boolean} - true si está en modo configuración
   */
  isInConfigMode() {
    return this.inConfigMode;
  }
}

module.exports = OltTelnetManager;
