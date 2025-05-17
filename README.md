# API OLT Telnet

API para gestionar conexiones Telnet a dispositivos OLT VSOL, permitiendo establecer conexiones, enviar comandos y gestionar el modo de configuración.

## Características

- Conexión Telnet a OLT VSOL usando el módulo nativo `net` de Node.js
- Gestión de sesiones persistentes
- Detección automática de prompts
- Manejo del proceso de autenticación inicial y elevación de privilegios
- Envío de comandos y recepción de respuestas
- API RESTful para interactuar con la OLT

## Requisitos

- Node.js 14.x o superior
- npm 6.x o superior

## Instalación

1. Clonar el repositorio:

```bash
git clone <url-del-repositorio>
cd api-olt-telnet
```

1. Instalar dependencias:

```bash
npm install
```

1. Configurar variables de entorno (opcional):

```bash
cp .env.example .env
# Editar .env según sea necesario
```

1. Iniciar el servidor:

```bash
npm start
```

Para desarrollo:

```bash
npm run dev
```

## Endpoints de la API

### Establecer conexión

```http
POST /api/olt/connect
```

**Parámetros (JSON):**

- `ip`: Dirección IP de la OLT (obligatorio)
- `port`: Puerto Telnet (opcional, por defecto 23)
- `username`: Nombre de usuario para el login (obligatorio)
- `password`: Contraseña para el login (obligatorio)
- `enablePassword`: Contraseña para el modo privilegiado/configuración (obligatorio)

**Respuesta:**

```json
{
  "success": true,
  "message": "Conexión establecida con éxito",
  "sessionId": "192.168.1.1-1621234567890",
  "status": {
    "connected": true,
    "loggedIn": true,
    "inConfigMode": false,
    "currentPrompt": "#"
  }
}
```

### Enviar comando

```http
POST /api/olt/send-command
```

**Parámetros (JSON):**

- `sessionId`: ID de sesión obtenido al conectar (obligatorio)
- `command`: Comando a enviar (obligatorio)
- `configMode`: Booleano que indica si se debe entrar en modo configuración antes de enviar el comando (opcional)

**Respuesta:**

```json
{
  "success": true,
  "response": "Respuesta del comando...",
  "status": {
    "connected": true,
    "loggedIn": true,
    "inConfigMode": true,
    "currentPrompt": "(config)#"
  }
}
```

### Desconectar

```http
POST /api/olt/disconnect
```

**Parámetros (JSON):**

- `sessionId`: ID de sesión a desconectar (obligatorio)

**Respuesta:**

```json
{
  "success": true,
  "message": "Desconexión exitosa"
}
```

### Verificar estado

```http
GET /api/olt/status/:sessionId
```

**Respuesta:**

```json
{
  "success": true,
  "status": {
    "connected": true,
    "loggedIn": true,
    "inConfigMode": false,
    "currentPrompt": "#"
  }
}
```

## Funcionamiento interno

### Gestión de la conexión Telnet

La clase `OltTelnetManager` se encarga de gestionar la conexión Telnet utilizando el módulo `net` de Node.js. Esta clase mantiene el estado de la conexión y proporciona métodos para:

1. Establecer la conexión y realizar el login
2. Enviar comandos y recibir respuestas
3. Entrar en modo configuración
4. Desconectar la sesión

### Detección de prompts

La aplicación detecta diferentes prompts para determinar el estado de la sesión:

- `Username:` o `Login:` - Solicitud de nombre de usuario
- `Password:` - Solicitud de contraseña (tanto para login inicial como para elevación de privilegios)
- `>` - Prompt de usuario normal
- `#` - Prompt de usuario privilegiado
- `(config)#` - Prompt de modo configuración

### Manejo de la elevación de privilegios

Cuando se envía el comando `configure terminal`, la OLT solicita una segunda contraseña para la elevación de privilegios. La aplicación detecta esta solicitud y envía automáticamente la contraseña de habilitación proporcionada durante la conexión.

### Gestión de sesiones

La API mantiene un registro de las sesiones activas utilizando un objeto en memoria. En un entorno de producción, se recomienda utilizar Redis u otra solución de almacenamiento para gestionar las sesiones.

## Notas sobre adaptación a OLT reales

- Los prompts pueden variar ligeramente según el modelo específico de OLT VSOL. La aplicación está diseñada para detectar patrones comunes, pero puede ser necesario ajustar las expresiones regulares de detección.
- Algunos dispositivos pueden tener tiempos de respuesta diferentes. El timeout por defecto es de 30 segundos, pero puede ser necesario ajustarlo.
- La aplicación asume que el dispositivo sigue un flujo estándar de autenticación y elevación de privilegios. Si el dispositivo tiene un comportamiento diferente, será necesario adaptar la lógica de detección de prompts.
