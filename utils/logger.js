const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Asegurarse de que el directorio de logs exista
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Función para obtener el nombre del archivo de log basado en la fecha actual
const getLogFileName = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.log`;
};

// Crear el formato personalizado para los logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
  })
);

// Crear el logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: logFormat,
  transports: [
    // Escribir logs a la consola
    new winston.transports.Console(),
    // Escribir logs a un archivo con el nombre de la fecha actual
    new winston.transports.File({
      filename: path.join(logDir, getLogFileName()),
      maxsize: 5242880, // 5MB
      maxFiles: 30,
    })
  ]
});

// Función para actualizar el archivo de log basado en la fecha actual
const updateLogFile = () => {
  const fileName = getLogFileName();
  const currentTransports = logger.transports;
  
  // Verificar si ya existe un transporte de archivo con el nombre correcto
  const fileTransport = currentTransports.find(
    t => t instanceof winston.transports.File
  );
  
  if (fileTransport && path.basename(fileTransport.filename) !== fileName) {
    // Eliminar el transporte de archivo antiguo
    logger.remove(fileTransport);
    
    // Añadir un nuevo transporte de archivo con el nombre actualizado
    logger.add(new winston.transports.File({
      filename: path.join(logDir, fileName),
      maxsize: 5242880, // 5MB
      maxFiles: 30,
    }));
  }
};

// Actualizar el archivo de log cada día a medianoche
setInterval(() => {
  updateLogFile();
}, 24 * 60 * 60 * 1000);

// También actualizar al iniciar la aplicación
updateLogFile();

module.exports = logger;
