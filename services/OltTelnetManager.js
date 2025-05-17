const net = require('net');
const logger = require('../utils/logger');

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
    logger.info(`Iniciando conexión a OLT: ${host}:${port}`, { host, port });
    return new Promise((resolve, reject) => {
      // Guardar la contraseña de habilitación para usarla más tarde
      this.enablePassword = enablePassword;
      logger.debug('Contraseña de habilitación guardada');
      
      // Crear un timeout para la conexión
      logger.debug(`Configurando timeout de conexión: ${this.connectionTimeout}ms`);
      const connectionTimeoutId = setTimeout(() => {
        if (this.client) {
          this.client.destroy();
        }
        logger.error(`Timeout de conexión después de ${this.connectionTimeout}ms`);
        reject(new Error('Timeout de conexión'));
      }, this.connectionTimeout);
      
      // Crear el cliente Telnet usando el módulo net
      logger.debug(`Creando conexión Telnet a ${host}:${port}`);
      this.client = net.createConnection({
        host,
        port
      }, () => {
        logger.info(`Conexión establecida a ${host}:${port}`);
        this.connected = true;
        clearTimeout(connectionTimeoutId);
      });

      // Configurar el encoding para manejar texto
      this.client.setEncoding('utf8');
      logger.debug('Encoding configurado a utf8');

      // Manejar datos recibidos
      this.client.on('data', (data) => {
        logger.debug(`Datos recibidos (${data.length} bytes)`);
        logger.silly(`Datos raw: ${data.replace(/\n/g, '\\n')}`);
        this.handleData(data, username, password, resolve, reject);
      });

      // Manejar errores
      this.client.on('error', (err) => {
        logger.error(`Error de conexión: ${err.message}`, { error: err.stack });
        clearTimeout(connectionTimeoutId);
        this.connected = false;
        reject(err);
      });

      // Manejar cierre de conexión
      this.client.on('close', () => {
        logger.info('Conexión cerrada');
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
    
    logger.debug(`Buffer actual: ${this.buffer.replace(/\n/g, '\\n')}`);

    // Detectar prompts y responder adecuadamente
    if (!this.loggedIn) {
      logger.debug('Estado: No logueado, procesando login');
      // Proceso de login
      if (this.buffer.includes('Username:') || this.buffer.includes('Login:')) {
        logger.info('Prompt de usuario detectado, enviando nombre de usuario');
        this.client.write(username + '\n');
        logger.debug(`Nombre de usuario enviado: ${username}`);
        this.buffer = '';
      } else if (this.buffer.includes('Password:')) {
        logger.info('Prompt de contraseña detectado, enviando contraseña');
        this.client.write(password + '\n');
        logger.debug('Contraseña enviada (valor oculto)');
        this.buffer = '';
      } else if (this.detectLoginSuccess()) {
        logger.info('Login exitoso detectado');
        this.loggedIn = true;
        this.updateCurrentPrompt();
        logger.debug(`Prompt actual actualizado a: ${this.currentPrompt}`);
        resolve(); // Resolvemos la promesa de conexión
        logger.debug('Promesa de conexión resuelta');
        this.buffer = '';
      } else if (this.detectLoginFailure()) {
        logger.error('Fallo de autenticación detectado');
        reject(new Error('Credenciales incorrectas'));
        logger.debug('Promesa de conexión rechazada: Credenciales incorrectas');
        this.buffer = '';
      }
    } else if (this.waitingForResponse) {
      logger.debug(`Estado: Logueado, esperando respuesta al comando: ${this.lastCommand}`);
      // Estamos esperando respuesta a un comando
      if (this.detectCommandPrompt()) {
        logger.info('Prompt de comando detectado, procesando respuesta');
        // Extraer la respuesta del comando (excluyendo el comando enviado y el prompt final)
        const response = this.extractCommandResponse();
        logger.debug(`Respuesta extraida (${response.length} caracteres)`);
        logger.silly(`Respuesta completa: ${response}`);
        
        // Actualizar el prompt actual
        this.updateCurrentPrompt();
        logger.debug(`Prompt actual actualizado a: ${this.currentPrompt}`);
        
        // Resolver la promesa pendiente con la respuesta
        if (this.responseResolver) {
          logger.debug('Resolviendo promesa de comando');
          this.responseResolver(response);
          this.responseResolver = null;
        }
        
        this.waitingForResponse = false;
        this.buffer = '';
      } else if (this.buffer.includes('Password:')) {
        // Detectamos solicitud de contraseña después de 'configure terminal' o 'enable'
        if (this.lastCommand.includes('configure terminal') || this.lastCommand.includes('enable')) {
          logger.info(`Prompt de contraseña detectado después de comando: ${this.lastCommand}`);
          logger.debug('Enviando contraseña de habilitación');
          this.client.write(this.enablePassword + '\n');
          logger.debug('Contraseña de habilitación enviada (valor oculto)');
          this.buffer = '';
        } else {
          logger.warn(`Prompt de contraseña detectado pero no se reconoce el contexto. Último comando: ${this.lastCommand}`);
        }
      }
    } else {
      logger.debug('Estado: Logueado, pero no esperando respuesta. Buffer ignorado.');
    }
  }

  /**
   * Detecta si el login fue exitoso basado en prompts típicos
   * @returns {boolean} - true si el login fue exitoso
   */
  detectLoginSuccess() {
    // Buscar prompts típicos que indican login exitoso
    const successPrompts = ['>', '#', '$'];
    const result = successPrompts.some(prompt => this.buffer.trim().endsWith(prompt));
    if (result) {
      logger.debug(`Login exitoso detectado, prompt encontrado: ${this.buffer.trim().slice(-1)}`);
    }
    return result;
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
    const result = failureMessages.some(msg => this.buffer.includes(msg));
    if (result) {
      const foundMessage = failureMessages.find(msg => this.buffer.includes(msg));
      logger.debug(`Fallo de login detectado, mensaje encontrado: ${foundMessage}`);
    }
    return result;
  }

  /**
   * Detecta si hemos recibido un prompt que indica que el comando ha finalizado
   * @returns {boolean} - true si se detectó un prompt de comando
   */
  detectCommandPrompt() {
    const prompts = ['>', '#', '(config)#', '(config-if)#'];
    const result = prompts.some(prompt => this.buffer.trim().endsWith(prompt));
    if (result) {
      const foundPrompt = prompts.find(prompt => this.buffer.trim().endsWith(prompt));
      logger.debug(`Prompt de comando detectado: ${foundPrompt}`);
    }
    return result;
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
    const oldPrompt = this.currentPrompt;
    
    if (buffer.endsWith('(config)#')) {
      this.currentPrompt = '(config)#';
      this.inConfigMode = true;
    } else if (buffer.endsWith('(config-if)#')) {
      this.currentPrompt = '(config-if)#';
      this.inConfigMode = true;
    } else if (buffer.endsWith('#')) {
      this.currentPrompt = '#';
    } else if (buffer.endsWith('>')) {
      this.currentPrompt = '>';
    }
    
    if (oldPrompt !== this.currentPrompt) {
      logger.info(`Prompt cambiado: ${oldPrompt || 'ninguno'} -> ${this.currentPrompt}`);
      if (this.inConfigMode) {
        logger.debug('Modo de configuración activado');
      }
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
        logger.error('Intento de enviar comando sin sesión activa');
        reject(new Error('No hay una sesión activa'));
        return;
      }

      // Guardar el comando actual
      this.lastCommand = command;
      logger.debug(`Comando guardado: ${command}`);
      
      // Configurar el estado para esperar respuesta
      this.waitingForResponse = true;
      this.responseResolver = resolve;
      this.buffer = '';
      logger.debug('Estado configurado para esperar respuesta');
      
      // Enviar el comando
      logger.info(`Enviando comando: ${command}`);
      this.client.write(command + '\n');
      logger.debug('Comando enviado al socket');
      
      // Establecer un timeout para la respuesta
      logger.debug('Configurando timeout para respuesta de comando: 30000ms');
      setTimeout(() => {
        if (this.waitingForResponse) {
          logger.error(`Timeout esperando respuesta al comando: ${command}`);
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
    logger.info('Intentando entrar en modo privilegiado (enable)');
    
    if (!this.connected || !this.loggedIn) {
      logger.error('Intento de entrar en modo privilegiado sin sesión activa');
      throw new Error('No hay una sesión activa');
    }
    
    if (this.currentPrompt === '#' || this.inConfigMode) {
      logger.info('Ya en modo privilegiado, no es necesario enviar comando enable');
      return 'Ya en modo privilegiado';
    }
    
    logger.debug('Enviando comando enable para entrar en modo privilegiado');
    const response = await this.sendCommand('enable');
    logger.info('Comando enable completado');
    logger.debug(`Respuesta: ${response}`);
    return response;
  }

  /**
   * Entra en modo de configuración (configure terminal)
   * @returns {Promise<string>} - Promesa que se resuelve cuando se ha entrado en modo configuración
   */
  async enterConfigMode() {
    logger.info('Intentando entrar en modo configuración (configure terminal)');
    
    if (!this.connected || !this.loggedIn) {
      logger.error('Intento de entrar en modo configuración sin sesión activa');
      throw new Error('No hay una sesión activa');
    }
    
    if (this.inConfigMode) {
      logger.info('Ya en modo configuración, no es necesario enviar comando configure terminal');
      return 'Ya en modo configuración';
    }
    
    // Si no estamos en modo privilegiado, primero entramos en él
    if (this.currentPrompt !== '#') {
      logger.debug('No estamos en modo privilegiado, entrando primero en modo enable');
      await this.enterEnableMode();
      logger.debug('Modo privilegiado activado, continuando con configure terminal');
    }
    
    logger.debug('Enviando comando configure terminal');
    const response = await this.sendCommand('configure terminal');
    this.inConfigMode = true;
    logger.info('Modo configuración activado');
    logger.debug(`Respuesta: ${response}`);
    return response;
  }

  /**
   * Cierra la conexión Telnet
   * @returns {Promise<void>} - Promesa que se resuelve cuando la conexión se ha cerrado
   */
  disconnect() {
    logger.info('Iniciando proceso de desconexión');
    return new Promise((resolve) => {
      if (!this.connected) {
        logger.debug('No hay conexión activa, nada que desconectar');
        resolve();
        return;
      }
      
      // Si estamos en modo configuración, salimos primero
      if (this.inConfigMode) {
        logger.debug('Saliendo del modo configuración');
        this.client.write('exit\n');
      }
      
      // Enviar comando de logout
      logger.debug('Enviando comando exit para cerrar sesión');
      this.client.write('exit\n');
      
      // Cerrar la conexión
      logger.debug('Cerrando socket de conexión');
      this.client.end();
      
      // Limpiar el estado
      this.connected = false;
      this.loggedIn = false;
      this.inConfigMode = false;
      this.buffer = '';
      this.currentPrompt = '';
      logger.info('Estado de conexión limpiado');
      
      logger.info('Desconexión completada');
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
