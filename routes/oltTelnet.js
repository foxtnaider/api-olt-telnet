const express = require('express');
const router = express.Router();
const OltTelnetManager = require('../services/OltTelnetManager');

// Almacenamiento de sesiones activas (en producción debería usarse Redis u otra solución)
const activeSessions = {};

// Endpoint para conectar a la OLT
router.post('/connect', async (req, res) => {
  try {
    const { ip, port, username, password, enablePassword } = req.body;
    
    // Validar parámetros obligatorios
    if (!ip || !username || !password || !enablePassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Se requieren los parámetros: ip, username, password y enablePassword' 
      });
    }

    // Crear un ID único para esta sesión
    const sessionId = `${ip}-${Date.now()}`;
    
    // Crear una nueva instancia del gestor de Telnet
    const oltManager = new OltTelnetManager();
    
    // Iniciar la conexión
    await oltManager.connect(ip, port || 23, username, password, enablePassword);
    
    // Guardar la sesión
    activeSessions[sessionId] = oltManager;
    
    res.json({ 
      success: true, 
      message: 'Conexión establecida con éxito', 
      sessionId,
      status: oltManager.getStatus()
    });
  } catch (error) {
    console.error('Error al conectar:', error);
    res.status(500).json({ 
      success: false, 
      message: `Error al conectar: ${error.message}` 
    });
  }
});

// Endpoint para enviar comandos
router.post('/send-command', async (req, res) => {
  try {
    const { sessionId, command, configMode } = req.body;
    
    // Validar parámetros obligatorios
    if (!sessionId || !command) {
      return res.status(400).json({ 
        success: false, 
        message: 'Se requieren los parámetros: sessionId y command' 
      });
    }
    
    // Verificar que la sesión exista
    if (!activeSessions[sessionId]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Sesión no encontrada o expirada' 
      });
    }
    
    const oltManager = activeSessions[sessionId];
    
    // Si se solicita entrar en modo configuración y no estamos en él
    if (configMode === true && !oltManager.isInConfigMode()) {
      await oltManager.enterConfigMode();
    }
    
    // Enviar el comando y esperar la respuesta
    const response = await oltManager.sendCommand(command);
    
    res.json({ 
      success: true, 
      response,
      status: oltManager.getStatus()
    });
  } catch (error) {
    console.error('Error al enviar comando:', error);
    res.status(500).json({ 
      success: false, 
      message: `Error al enviar comando: ${error.message}` 
    });
  }
});

// Endpoint para desconectar
router.post('/disconnect', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    // Validar parámetros obligatorios
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Se requiere el parámetro: sessionId' 
      });
    }
    
    // Verificar que la sesión exista
    if (!activeSessions[sessionId]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Sesión no encontrada o ya cerrada' 
      });
    }
    
    const oltManager = activeSessions[sessionId];
    
    // Cerrar la conexión
    await oltManager.disconnect();
    
    // Eliminar la sesión
    delete activeSessions[sessionId];
    
    res.json({ 
      success: true, 
      message: 'Desconexión exitosa' 
    });
  } catch (error) {
    console.error('Error al desconectar:', error);
    res.status(500).json({ 
      success: false, 
      message: `Error al desconectar: ${error.message}` 
    });
  }
});

// Endpoint para entrar en modo privilegiado (enable)
router.post('/enable', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    // Validar parámetros obligatorios
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Se requiere el parámetro: sessionId' 
      });
    }
    
    // Verificar que la sesión exista
    if (!activeSessions[sessionId]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Sesión no encontrada o expirada' 
      });
    }
    
    const oltManager = activeSessions[sessionId];
    
    // Entrar en modo privilegiado
    const response = await oltManager.enterEnableMode();
    
    res.json({ 
      success: true, 
      response,
      status: oltManager.getStatus()
    });
  } catch (error) {
    console.error('Error al entrar en modo privilegiado:', error);
    res.status(500).json({ 
      success: false, 
      message: `Error al entrar en modo privilegiado: ${error.message}` 
    });
  }
});

// Endpoint para verificar el estado de una sesión
router.get('/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (!activeSessions[sessionId]) {
    return res.status(404).json({ 
      success: false, 
      message: 'Sesión no encontrada' 
    });
  }
  
  const oltManager = activeSessions[sessionId];
  
  res.json({ 
    success: true, 
    status: oltManager.getStatus() 
  });
});

module.exports = router;
