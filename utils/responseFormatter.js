/**
 * Utilidad para formatear respuestas de la OLT
 */

const logger = require('./logger');

/**
 * Limpia y formatea la salida de comandos específicos de la OLT
 * @param {string} command - El comando ejecutado
 * @param {string} response - La respuesta cruda de la OLT
 * @returns {object} - La respuesta formateada según el tipo de comando
 */
function formatResponse(command, response) {
  logger.debug(`Formateando respuesta para comando: ${command}`);
  
  // Primero aplicamos la limpieza básica a todas las respuestas
  const cleanedResponse = cleanResponse(response);
  
  // Comandos que devuelven tablas específicas
  if (command.includes('show mac address-table')) {
    return formatMacAddressTable(response);
  } else if (command.includes('show interface') || command.match(/show int(erface)?\s+\S+/)) {
    return formatInterfaceInfo(cleanedResponse, command);
  } else if (command.includes('show running-config')) {
    return formatRunningConfig(cleanedResponse);
  } else if (command.includes('show onu')) {
    return formatOnuInfo(cleanedResponse);
  } else if (command.match(/show\s+(\S+\s+)?table/)) {
    // Cualquier comando show que incluya 'table' probablemente sea una tabla
    return formatGenericTable(cleanedResponse);
  } else if (command.startsWith('show ')) {
    // Intentar detectar si es una tabla para otros comandos show
    return detectAndFormatTable(cleanedResponse);
  }
  
  // Para otros comandos, devolver la respuesta limpia
  return {
    raw: cleanedResponse,
    formatted: cleanedResponse,
    data: null
  };
}

/**
 * Limpia caracteres de control básicos de cualquier respuesta
 * @param {string} response - La respuesta cruda
 * @returns {string} - La respuesta limpia
 */
function cleanResponse(response) {
  // Reemplazar secuencias de retorno de carro + nueva línea por solo nueva línea
  let cleaned = response.replace(/\r\n/g, '\n');
  
  // Eliminar secuencias de backspace y el carácter que borran
  // Primero, manejar secuencias simples de un carácter seguido de backspace
  cleaned = cleaned.replace(/.\x08/g, '');
  
  // Luego, manejar secuencias más complejas de múltiples backspaces
  cleaned = cleaned.replace(/\x08+\s*\x08*/g, '');
  
  // Eliminar secuencias de escape ANSI (colores, cursor, etc)
  cleaned = cleaned.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  
  // Eliminar otros caracteres de control que puedan causar problemas
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  
  return cleaned;
}

/**
 * Formatea específicamente la tabla de direcciones MAC
 * @param {string} response - La respuesta cruda del comando show mac address-table
 * @returns {object} - Objeto con la tabla formateada y datos estructurados
 */
function formatMacAddressTable(response) {
  logger.debug('Formateando tabla de direcciones MAC');
  
  // Limpiar caracteres de control
  let cleaned = cleanResponse(response);
  
  // Eliminar secuencias de backspace más agresivamente (específico para este comando)
  cleaned = cleaned.replace(/\x08+\s*\x08+/g, ''); // Usar código hexadecimal para backspace (\x08)
  
  // Dividir por líneas
  const lines = cleaned.split('\n').filter(line => line.trim() !== '');
  
  // Extraer datos estructurados
  const macAddresses = [];
  let isDataSection = false;
  
  for (const line of lines) {
    // Detectar inicio de la sección de datos
    if (line.includes('----   --------------')) {
      isDataSection = true;
      continue;
    }
    
    // Procesar líneas de datos
    if (isDataSection && line.trim() !== '') {
      // Ignorar líneas de separación y encabezados
      if (line.includes('------------------') || 
          line.includes('Mac Address Table') || 
          line.includes('Vlan') ||
          line.includes('Total Addresses Found')) {
        continue;
      }
      
      // Extraer campos de la línea
      const fields = line.trim().split(/\s+/);
      
      // Verificar que la línea tenga suficientes campos para ser una entrada válida
      if (fields.length >= 5) {
        try {
          const vlan = fields[0];
          const macAddress = fields[1];
          const type = fields[2];
          
          // El puerto puede estar en diferentes posiciones dependiendo del formato
          let port = '';
          if (fields.length >= 5) {
            port = fields[3];
            // Si el puerto es GPON, incluir también el número de puerto
            if (port === 'GPON' && fields.length >= 6) {
              port = `${port} ${fields[4]}`;
            }
          }
          
          // El estado puede estar en diferentes posiciones
          const state = fields[fields.length - 1];
          
          macAddresses.push({
            vlan,
            macAddress,
            type,
            port,
            state
          });
        } catch (error) {
          logger.error(`Error al procesar línea de tabla MAC: ${line}`, error);
        }
      }
    }
  }
  
  logger.info(`Se procesaron ${macAddresses.length} direcciones MAC`);
  
  return {
    raw: cleaned,
    formatted: formatAsTable(macAddresses),
    data: macAddresses
  };
}

/**
 * Formatea un array de objetos como una tabla de texto
 * @param {Array} data - Array de objetos con los mismos campos
 * @returns {string} - Tabla formateada como texto
 */
function formatAsTable(data) {
  if (!data || data.length === 0) {
    return 'No data';
  }
  
  // Obtener las claves (columnas) del primer objeto
  const keys = Object.keys(data[0]);
  
  // Determinar el ancho máximo para cada columna
  const widths = {};
  keys.forEach(key => {
    // Inicializar con el largo del nombre de la columna
    widths[key] = key.length;
    
    // Encontrar el valor más largo para esta columna
    data.forEach(row => {
      const valueLength = String(row[key]).length;
      widths[key] = Math.max(widths[key], valueLength);
    });
  });
  
  // Crear la línea de encabezado
  let table = keys.map(key => key.padEnd(widths[key])).join(' | ') + '\n';
  
  // Crear la línea separadora
  table += keys.map(key => '-'.repeat(widths[key])).join('-+-') + '\n';
  
  // Agregar las filas de datos
  data.forEach(row => {
    table += keys.map(key => String(row[key]).padEnd(widths[key])).join(' | ') + '\n';
  });
  
  return table;
}

/**
 * Formatea la información de una interfaz
 * @param {string} response - La respuesta limpia del comando show interface
 * @param {string} command - El comando original
 * @returns {object} - Objeto con la información formateada
 */
function formatInterfaceInfo(response, command) {
  logger.debug('Formateando información de interfaz');
  
  // Extraer el nombre de la interfaz del comando
  let interfaceName = '';
  const match = command.match(/show\s+int(?:erface)?\s+(\S+)/i);
  if (match && match[1]) {
    interfaceName = match[1];
  }
  
  // Dividir por líneas
  const lines = response.split('\n').filter(line => line.trim() !== '');
  
  // Extraer información clave
  const interfaceData = {
    name: interfaceName,
    status: '',
    hardware: '',
    description: '',
    macAddress: '',
    statistics: {}
  };
  
  // Buscar patrones comunes en la salida
  for (const line of lines) {
    if (line.includes('is ') && (line.includes(' up') || line.includes(' down'))) {
      interfaceData.status = line.includes(' up') ? 'up' : 'down';
    }
    if (line.includes('Hardware is')) {
      interfaceData.hardware = line.replace(/.*Hardware is\s+/, '').trim();
    }
    if (line.includes('Description:')) {
      interfaceData.description = line.replace(/.*Description:\s+/, '').trim();
    }
    if (line.match(/MAC\s+[Aa]ddress/)) {
      const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
      if (macMatch) {
        interfaceData.macAddress = macMatch[0];
      }
    }
    
    // Estadísticas
    if (line.includes('packets input')) {
      const match = line.match(/(\d+)\s+packets\s+input/);
      if (match) {
        interfaceData.statistics.packetsInput = parseInt(match[1], 10);
      }
    }
    if (line.includes('packets output')) {
      const match = line.match(/(\d+)\s+packets\s+output/);
      if (match) {
        interfaceData.statistics.packetsOutput = parseInt(match[1], 10);
      }
    }
  }
  
  return {
    raw: response,
    formatted: formatAsKeyValueText(interfaceData),
    data: interfaceData
  };
}

/**
 * Formatea la configuración en ejecución
 * @param {string} response - La respuesta limpia del comando show running-config
 * @returns {object} - Objeto con la configuración formateada
 */
function formatRunningConfig(response) {
  logger.debug('Formateando configuración en ejecución');
  
  // Dividir por secciones
  const sections = {};
  let currentSection = 'global';
  
  const lines = response.split('\n');
  const configData = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Detectar cambios de sección
    if (trimmedLine.startsWith('interface ')) {
      currentSection = 'interface:' + trimmedLine.substring(10).trim();
    } else if (trimmedLine.startsWith('router ')) {
      currentSection = 'router:' + trimmedLine.substring(7).trim();
    } else if (trimmedLine.startsWith('line ')) {
      currentSection = 'line:' + trimmedLine.substring(5).trim();
    }
    
    // Almacenar la línea en la sección actual
    if (!sections[currentSection]) {
      sections[currentSection] = [];
    }
    sections[currentSection].push(trimmedLine);
    
    // Agregar a los datos estructurados
    configData.push({
      section: currentSection,
      command: trimmedLine
    });
  }
  
  // Formatear la salida
  let formatted = '';
  for (const section in sections) {
    formatted += `=== ${section} ===\n`;
    formatted += sections[section].join('\n');
    formatted += '\n\n';
  }
  
  return {
    raw: response,
    formatted: formatted.trim(),
    data: {
      sections,
      configData
    }
  };
}

/**
 * Formatea la información de ONUs
 * @param {string} response - La respuesta limpia del comando show onu
 * @returns {object} - Objeto con la información formateada
 */
function formatOnuInfo(response) {
  logger.debug('Formateando información de ONUs');
  
  // Dividir por líneas
  const lines = response.split('\n').filter(line => line.trim() !== '');
  
  // Detectar si es una tabla
  const isTable = lines.some(line => 
    line.includes('----') || 
    (line.includes('ID') && line.includes('Serial') && line.includes('Status'))
  );
  
  if (isTable) {
    return formatGenericTable(response);
  }
  
  // Si no es una tabla, procesar como información detallada de una ONU
  const onuData = {};
  let currentSection = 'general';
  
  for (const line of lines) {
    // Detectar cambios de sección
    if (line.match(/^\s*[\-=]{3,}\s*[\w\s]+\s*[\-=]{3,}\s*$/)) {
      currentSection = line.trim().replace(/[\-=]/g, '').trim().toLowerCase();
      continue;
    }
    
    // Buscar pares clave-valor
    const kvMatch = line.match(/^\s*([\w\s\-]+)\s*:\s*(.+)\s*$/);
    if (kvMatch) {
      const key = kvMatch[1].trim().replace(/\s+/g, '_').toLowerCase();
      const value = kvMatch[2].trim();
      
      if (!onuData[currentSection]) {
        onuData[currentSection] = {};
      }
      onuData[currentSection][key] = value;
    }
  }
  
  return {
    raw: response,
    formatted: formatAsNestedKeyValue(onuData),
    data: onuData
  };
}

/**
 * Formatea una tabla genérica
 * @param {string} response - La respuesta limpia que contiene una tabla
 * @returns {object} - Objeto con la tabla formateada
 */
function formatGenericTable(response) {
  logger.debug('Formateando tabla genérica');
  
  // Dividir por líneas
  const lines = response.split('\n').filter(line => line.trim() !== '');
  
  // Buscar líneas de encabezado y separadores
  let headerLine = -1;
  let separatorLine = -1;
  
  for (let i = 0; i < lines.length; i++) {
    // Buscar línea que parece un encabezado (palabras separadas por espacios)
    if (headerLine === -1 && lines[i].trim().split(/\s+/).length > 1 && 
        !lines[i].includes('----') && !lines[i].match(/^\s*$/)) {
      headerLine = i;
    }
    
    // Buscar línea separadora (muchos guiones o igual)
    if (lines[i].match(/^\s*[\-=]{3,}/) || lines[i].match(/\s+[\-=]{3,}\s+/)) {
      separatorLine = i;
      // Si encontramos un separador después de un posible encabezado, confirmamos el encabezado
      if (headerLine !== -1 && separatorLine > headerLine) {
        break;
      }
    }
  }
  
  // Si no encontramos un formato de tabla claro, intentar detectar columnas por alineación
  if (headerLine === -1 || separatorLine === -1) {
    return detectTableByAlignment(lines);
  }
  
  // Extraer encabezados
  const headers = lines[headerLine].trim().split(/\s{2,}/);
  
  // Encontrar índices de columnas basados en el encabezado
  const columnIndices = [];
  let startIndex = 0;
  
  for (const header of headers) {
    const index = lines[headerLine].indexOf(header, startIndex);
    if (index !== -1) {
      columnIndices.push(index);
      startIndex = index + header.length;
    }
  }
  
  // Procesar filas de datos
  const tableData = [];
  
  for (let i = separatorLine + 1; i < lines.length; i++) {
    // Ignorar líneas vacías o separadores
    if (lines[i].trim() === '' || lines[i].match(/^\s*[\-=]{3,}/)) {
      continue;
    }
    
    const row = {};
    
    // Extraer valores de columnas
    for (let j = 0; j < headers.length; j++) {
      const start = columnIndices[j];
      const end = j < headers.length - 1 ? columnIndices[j + 1] : lines[i].length;
      
      if (start < lines[i].length) {
        const value = lines[i].substring(start, end).trim();
        row[headers[j].trim()] = value;
      } else {
        row[headers[j].trim()] = '';
      }
    }
    
    tableData.push(row);
  }
  
  return {
    raw: response,
    formatted: formatAsTable(tableData),
    data: tableData
  };
}

/**
 * Detecta y formatea una tabla basada en la alineación de columnas
 * @param {Array} lines - Las líneas de texto
 * @returns {object} - Objeto con la tabla formateada
 */
function detectTableByAlignment(lines) {
  logger.debug('Detectando tabla por alineación de columnas');
  
  // Buscar patrones de espaciado consistentes
  const spacingPatterns = [];
  
  // Analizar las primeras líneas para detectar patrones
  const sampleSize = Math.min(lines.length, 10);
  
  for (let i = 0; i < sampleSize; i++) {
    const line = lines[i];
    const pattern = [];
    let inWord = false;
    
    for (let j = 0; j < line.length; j++) {
      if (line[j] !== ' ' && !inWord) {
        pattern.push(j); // Inicio de palabra
        inWord = true;
      } else if (line[j] === ' ' && inWord) {
        inWord = false;
      }
    }
    
    if (pattern.length > 1) {
      spacingPatterns.push(pattern);
    }
  }
  
  // Si no hay patrones consistentes, devolver el texto sin procesar
  if (spacingPatterns.length === 0) {
    return {
      raw: lines.join('\n'),
      formatted: lines.join('\n'),
      data: null
    };
  }
  
  // Encontrar el patrón más común o más largo
  let bestPattern = spacingPatterns[0];
  for (const pattern of spacingPatterns) {
    if (pattern.length > bestPattern.length) {
      bestPattern = pattern;
    }
  }
  
  // Usar el patrón para extraer encabezados y datos
  // Buscar una línea que parezca un encabezado (no tiene números al inicio)
  let headerLine = 0;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (!lines[i].trim().match(/^\d+/) && lines[i].trim().length > 0) {
      headerLine = i;
      break;
    }
  }
  
  // Extraer encabezados basados en el patrón
  const headers = [];
  for (let i = 0; i < bestPattern.length; i++) {
    const start = bestPattern[i];
    const end = i < bestPattern.length - 1 ? bestPattern[i + 1] : lines[headerLine].length;
    const header = lines[headerLine].substring(start, end).trim();
    if (header) {
      headers.push(header);
    }
  }
  
  // Procesar filas de datos
  const tableData = [];
  
  for (let i = headerLine + 1; i < lines.length; i++) {
    // Ignorar líneas vacías o separadores
    if (lines[i].trim() === '' || lines[i].match(/^\s*[\-=]{3,}/)) {
      continue;
    }
    
    const row = {};
    
    // Extraer valores de columnas
    for (let j = 0; j < headers.length; j++) {
      const start = bestPattern[j] || 0;
      const end = j < bestPattern.length - 1 ? bestPattern[j + 1] : lines[i].length;
      
      if (start < lines[i].length) {
        const value = lines[i].substring(start, end).trim();
        row[headers[j]] = value;
      } else {
        row[headers[j]] = '';
      }
    }
    
    tableData.push(row);
  }
  
  return {
    raw: lines.join('\n'),
    formatted: formatAsTable(tableData),
    data: tableData
  };
}

/**
 * Detecta si una respuesta contiene una tabla y la formatea
 * @param {string} response - La respuesta limpia
 * @returns {object} - Objeto con la respuesta formateada
 */
function detectAndFormatTable(response) {
  logger.debug('Detectando si la respuesta contiene una tabla');
  
  // Dividir por líneas
  const lines = response.split('\n').filter(line => line.trim() !== '');
  
  // Características que sugieren una tabla
  const hasHeaderSeparator = lines.some(line => line.match(/^\s*[\-=]{3,}/) || line.match(/\s+[\-=]{3,}\s+/));
  const hasConsistentSpacing = lines.some(line => line.match(/\S+\s{2,}\S+\s{2,}\S+/));
  const hasColumnAlignment = lines.length > 3 && 
    lines.slice(0, 3).every(line => line.match(/\S+\s+\S+/) && 
    lines[0].indexOf(' ') === lines[1].indexOf(' '));
  
  if (hasHeaderSeparator || hasConsistentSpacing || hasColumnAlignment) {
    return formatGenericTable(response);
  }
  
  // Si no parece una tabla, devolver el texto limpio
  return {
    raw: response,
    formatted: response,
    data: null
  };
}

/**
 * Formatea un objeto como texto con pares clave-valor
 * @param {object} data - Objeto a formatear
 * @returns {string} - Texto formateado
 */
function formatAsKeyValueText(data, indent = 0) {
  let result = '';
  const indentStr = ' '.repeat(indent);
  
  for (const key in data) {
    if (typeof data[key] === 'object' && data[key] !== null) {
      result += `${indentStr}${key.replace(/_/g, ' ')}:\n`;
      result += formatAsKeyValueText(data[key], indent + 2);
    } else {
      result += `${indentStr}${key.replace(/_/g, ' ')}: ${data[key]}\n`;
    }
  }
  
  return result;
}

/**
 * Formatea un objeto anidado como texto con pares clave-valor
 * @param {object} data - Objeto anidado a formatear
 * @returns {string} - Texto formateado
 */
function formatAsNestedKeyValue(data) {
  let result = '';
  
  for (const section in data) {
    result += `=== ${section.toUpperCase()} ===\n`;
    
    for (const key in data[section]) {
      result += `  ${key.replace(/_/g, ' ')}: ${data[section][key]}\n`;
    }
    
    result += '\n';
  }
  
  return result.trim();
}

module.exports = {
  formatResponse,
  cleanResponse
};
