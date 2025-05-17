const express = require('express');
const dotenv = require('dotenv');
const oltTelnetRouter = require('./routes/oltTelnet');
const logger = require('./utils/logger');

// Cargar variables de entorno
dotenv.config();
logger.info('Variables de entorno cargadas');

// Crear la aplicación Express
const app = express();
const PORT = process.env.PORT || 3000;
logger.info(`Puerto configurado: ${PORT}`);

// Middleware para parsear JSON
app.use(express.json());
logger.info('Middleware JSON configurado');

// Middleware para logging de solicitudes HTTP
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Rutas
app.use('/api/olt', oltTelnetRouter);

// Ruta base
app.get('/', (req, res) => {
  res.json({
    message: 'API OLT Telnet funcionando correctamente',
    endpoints: {
      connect: '/api/olt/connect',
      sendCommand: '/api/olt/send-command',
      disconnect: '/api/olt/disconnect'
    }
  });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  logger.error(`Error no capturado: ${error.message}`, { error: error.stack });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Promesa rechazada no manejada: ${reason}`, { reason });
});

// Iniciar el servidor
app.listen(PORT, () => {
  logger.info(`Servidor iniciado en el puerto ${PORT}`);
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});
