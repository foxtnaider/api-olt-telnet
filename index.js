const express = require('express');
const dotenv = require('dotenv');
const oltTelnetRouter = require('./routes/oltTelnet');

// Cargar variables de entorno
dotenv.config();

// Crear la aplicación Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

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

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});
