const express = require('express');
const router = express.Router();
const OltTelnetManager = require('../services/OltTelnetManager');
const logger = require('../utils/logger');

// Almacenamiento de sesiones activas (en producción debería usarse Redis u otra solución)
const activeSessions = {};

// Endpoint para conectar a la OLT
router.post('/connect', async (req, res) => {
  logger.info('Solicitud recibida: POST /connect');
  try {
    const { ip, port, username, password, enablePassword } = req.body;
    logger.debug('Parámetros de conexión recibidos', { ip, port, username: '***' });
    
    // Validar parámetros obligatorios
    if (!ip || !username || !password || !enablePassword) {
      logger.warn('Solicitud de conexión con parámetros incompletos', { ip, username: username ? 'presente' : 'ausente' });
      return res.status(400).json({ 
        success: false, 
        message: 'Se requieren los parámetros: ip, username, password y enablePassword' 
      });
    }

    // Crear un ID único para esta sesión
    const sessionId = `${ip}-${Date.now()}`;
    logger.debug(`ID de sesión generado: ${sessionId}`);
    
    // Crear una nueva instancia del gestor de Telnet
    const oltManager = new OltTelnetManager();
    logger.debug('Instancia de OltTelnetManager creada');
    
    // Iniciar la conexión
    logger.info(`Iniciando conexión a OLT: ${ip}:${port || 23}`);
    await oltManager.connect(ip, port || 23, username, password, enablePassword);
    logger.info(`Conexión establecida con éxito a OLT: ${ip}`);
    
    // Guardar la sesión
    activeSessions[sessionId] = oltManager;
    logger.debug(`Sesión guardada con ID: ${sessionId}`);
    
    const status = oltManager.getStatus();
    logger.info(`Estado de la sesión: ${JSON.stringify(status)}`);
    
    res.json({ 
      success: true, 
      message: 'Conexión establecida con éxito', 
      sessionId,
      status
    });
    logger.debug('Respuesta de conexión exitosa enviada');
  } catch (error) {
    logger.error(`Error al conectar: ${error.message}`, { error: error.stack });
    res.status(500).json({ 
      success: false, 
      message: `Error al conectar: ${error.message}` 
    });
    logger.debug('Respuesta de error enviada');
  }
});

// Endpoint para enviar comandos
router.post('/send-command', async (req, res) => {
  logger.info('Solicitud recibida: POST /send-command');
  try {
    const { sessionId, command, configMode } = req.body;
    logger.debug('Parámetros de comando recibidos', { sessionId, command, configMode });
    
    // Validar parámetros obligatorios
    if (!sessionId || !command) {
      logger.warn('Solicitud de comando con parámetros incompletos', { sessionId: !!sessionId, command: !!command });
      return res.status(400).json({ 
        success: false, 
        message: 'Se requieren los parámetros: sessionId y command' 
      });
    }
    
    // Verificar que la sesión exista
    if (!activeSessions[sessionId]) {
      logger.warn(`Sesión no encontrada: ${sessionId}`);
      return res.status(404).json({ 
        success: false, 
        message: 'Sesión no encontrada o expirada' 
      });
    }
    
    const oltManager = activeSessions[sessionId];
    logger.debug(`Sesión encontrada: ${sessionId}`);
    
    // Si se solicita entrar en modo configuración y no estamos en él
    if (configMode === true && !oltManager.isInConfigMode()) {
      logger.info('Entrando en modo configuración antes de enviar comando');
      await oltManager.enterConfigMode();
      logger.debug('Modo configuración activado');
    }
    
    // Enviar el comando y esperar la respuesta
    logger.info(`Enviando comando: ${command}`);
    const response = await oltManager.sendCommand(command);
    logger.debug(`Respuesta recibida (${response.length} caracteres)`);
    logger.silly(`Respuesta completa: ${response}`);
    
    const status = oltManager.getStatus();
    logger.info(`Estado actual de la sesión: ${JSON.stringify(status)}`);
    
    res.json({ 
      success: true, 
      response,
      status
    });
    logger.debug('Respuesta de comando exitosa enviada');
  } catch (error) {
    logger.error(`Error al enviar comando: ${error.message}`, { error: error.stack });
    res.status(500).json({ 
      success: false, 
      message: `Error al enviar comando: ${error.message}` 
    });
    logger.debug('Respuesta de error enviada');
  }
});

// Endpoint para desconectar
router.post('/disconnect', async (req, res) => {
  logger.info('Solicitud recibida: POST /disconnect');
  try {
    const { sessionId } = req.body;
    logger.debug('Parámetros recibidos', { sessionId });
    
    // Validar parámetros obligatorios
    if (!sessionId) {
      logger.warn('Solicitud de desconexión sin sessionId');
      return res.status(400).json({ 
        success: false, 
        message: 'Se requiere el parámetro: sessionId' 
      });
    }
    
    // Verificar que la sesión exista
    if (!activeSessions[sessionId]) {
      logger.warn(`Sesión no encontrada para desconexión: ${sessionId}`);
      return res.status(404).json({ 
        success: false, 
        message: 'Sesión no encontrada o ya cerrada' 
      });
    }
    
    const oltManager = activeSessions[sessionId];
    logger.debug(`Sesión encontrada para desconexión: ${sessionId}`);
    
    // Cerrar la conexión
    logger.info(`Iniciando desconexión de sesión: ${sessionId}`);
    await oltManager.disconnect();
    logger.debug('Desconexión completada');
    
    // Eliminar la sesión
    delete activeSessions[sessionId];
    logger.info(`Sesión eliminada: ${sessionId}`);
    
    res.json({ 
      success: true, 
      message: 'Desconexión exitosa' 
    });
    logger.debug('Respuesta de desconexión exitosa enviada');
  } catch (error) {
    logger.error(`Error al desconectar: ${error.message}`, { error: error.stack });
    res.status(500).json({ 
      success: false, 
      message: `Error al desconectar: ${error.message}` 
    });
    logger.debug('Respuesta de error enviada');
  }
});

// Endpoint para entrar en modo privilegiado (enable)
router.post('/enable', async (req, res) => {
  logger.info('Solicitud recibida: POST /enable');
  try {
    const { sessionId } = req.body;
    logger.debug('Parámetros recibidos', { sessionId });
    
    // Validar parámetros obligatorios
    if (!sessionId) {
      logger.warn('Solicitud de enable sin sessionId');
      return res.status(400).json({ 
        success: false, 
        message: 'Se requiere el parámetro: sessionId' 
      });
    }
    
    // Verificar que la sesión exista
    if (!activeSessions[sessionId]) {
      logger.warn(`Sesión no encontrada: ${sessionId}`);
      return res.status(404).json({ 
        success: false, 
        message: 'Sesión no encontrada o expirada' 
      });
    }
    
    const oltManager = activeSessions[sessionId];
    logger.debug(`Sesión encontrada: ${sessionId}`);
    
    // Entrar en modo privilegiado
    logger.info('Iniciando entrada en modo privilegiado');
    const response = await oltManager.enterEnableMode();
    logger.debug(`Respuesta de enable recibida: ${response}`);
    
    const status = oltManager.getStatus();
    logger.info(`Estado actual de la sesión: ${JSON.stringify(status)}`);
    
    res.json({ 
      success: true, 
      response,
      status
    });
    logger.debug('Respuesta de enable exitosa enviada');
  } catch (error) {
    logger.error(`Error al entrar en modo privilegiado: ${error.message}`, { error: error.stack });
    res.status(500).json({ 
      success: false, 
      message: `Error al entrar en modo privilegiado: ${error.message}` 
    });
    logger.debug('Respuesta de error enviada');
  }
});

// Endpoint para verificar el estado de una sesión
router.get('/status/:sessionId', (req, res) => {
  logger.info('Solicitud recibida: GET /status/:sessionId');
  const { sessionId } = req.params;
  logger.debug(`Verificando estado de sesión: ${sessionId}`);
  
  if (!activeSessions[sessionId]) {
    logger.warn(`Sesión no encontrada para status: ${sessionId}`);
    return res.status(404).json({ 
      success: false, 
      message: 'Sesión no encontrada' 
    });
  }
  
  const oltManager = activeSessions[sessionId];
  logger.debug(`Sesión encontrada: ${sessionId}`);
  
  const status = oltManager.getStatus();
  logger.info(`Estado de la sesión ${sessionId}: ${JSON.stringify(status)}`);
  
  res.json({ 
    success: true, 
    status
  });
  logger.debug('Respuesta de status enviada');
});

module.exports = router;
