const path = require('path');
const crypto = require('crypto');
const mkdirp = require('mkdirp');

class Utils {
  static sanitizePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('Invalid path');
    }
    
    const normalized = path.normalize(inputPath);
    
    if (normalized.includes('..')) {
      throw new Error('Path traversal not allowed');
    }
    
    return normalized;
  }

  static async ensureDirectoryExists(filePath) {
    const directory = path.dirname(filePath);
    await mkdirp(directory);
  }

  static generateFilename(template, data) {
    if (!template) return 'recording.guac';
    
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    
    const templateData = {
      timestamp,
      ...data
    };
    
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return templateData[key] || match;
    });
  }

  static sanitizeWebhookPayload(data) {
    if (!data || typeof data !== 'object') return data;
    
    const sensitiveFields = [
      'password',
      'private-key',
      'secret',
      'token',
      'passphrase',
      'secret_key',
      'access_key',
      'api_key'
    ];
    
    const sanitized = JSON.parse(JSON.stringify(data));
    
    function removeSensitiveFields(obj) {
      if (typeof obj === 'object' && obj !== null) {
        for (const key of Object.keys(obj)) {
          if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
            obj[key] = '[REDACTED]';
          } else if (typeof obj[key] === 'object') {
            removeSensitiveFields(obj[key]);
          }
        }
      }
    }
    
    removeSensitiveFields(sanitized);
    return sanitized;
  }

  static createRetryWrapper(fn, maxRetries = 3, baseDelay = 1000) {
    return async function(...args) {
      let lastError;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await fn.apply(this, args);
        } catch (error) {
          lastError = error;
          
          if (attempt === maxRetries) {
            throw lastError;
          }
          
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    };
  }

  static getFileExtensionForCompression(format) {
    switch (format) {
      case 'gzip':
        return '.gz';
      case 'zip':
        return '.zip';
      case 'none':
      default:
        return '';
    }
  }

  static isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  static parseConnectionId(connectionId) {
    if (!connectionId || typeof connectionId !== 'string') {
      return null;
    }
    
    return connectionId;
  }

  static createConnectionSettings(token, config) {
    const settings = { ...token };
    
    if (config.defaults) {
      if (config.defaults.all) {
        Object.assign(settings, config.defaults.all);
      }
      
      if (settings.protocol && config.defaults[settings.protocol]) {
        Object.assign(settings, config.defaults[settings.protocol]);
      }
    }
    
    if (config.drive_path_template && settings.protocol === 'rdp') {
      const drivePath = config.drive_path_template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return token.meta && token.meta[key] ? token.meta[key] : match;
      });
      settings['drive-path'] = drivePath;
    }
    
    return settings;
  }
}

module.exports = Utils;