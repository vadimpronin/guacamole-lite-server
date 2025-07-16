const ini = require('ini');
const fs = require('fs');
const path = require('path');

class ConfigLoader {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = null;
  }

  load() {
    let config = {};
    
    if (fs.existsSync(this.configPath)) {
      const configContent = fs.readFileSync(this.configPath, 'utf8');
      config = ini.parse(configContent);
    }
    
    this.config = this.processConfig(config);
    this.mergeEnvironmentVariables();
    this.validateConfig();
    
    return this.config;
  }

  processConfig(config) {
    const processed = {};
    
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'object' && value !== null) {
        processed[key] = {};
        for (const [subKey, subValue] of Object.entries(value)) {
          if (typeof subValue === 'object' && subValue !== null) {
            processed[key][subKey] = {};
            for (const [nestedKey, nestedValue] of Object.entries(subValue)) {
              processed[key][subKey][nestedKey] = this.convertType(nestedValue);
            }
          } else {
            processed[key][subKey] = this.convertType(subValue);
          }
        }
      } else {
        processed[key] = this.convertType(value);
      }
    }
    
    return processed;
  }

  convertType(value) {
    if (typeof value !== 'string') return value;
    
    const trimmed = value.trim();
    
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }
    
    if (/^\d+\.\d+$/.test(trimmed)) {
      return parseFloat(trimmed);
    }
    
    if (trimmed.includes(',')) {
      return trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
    
    return trimmed;
  }

  mergeEnvironmentVariables() {
    this.mergeEnvVarsForSection('', this.config);
    
    if (this.config.defaults && typeof this.config.defaults === 'object') {
      for (const [protocol, settings] of Object.entries(this.config.defaults)) {
        if (typeof settings === 'object' && settings !== null) {
          this.mergeEnvVarsForSection(`DEFAULTS_${protocol.toUpperCase()}_`, settings);
        }
      }
    }
  }

  mergeEnvVarsForSection(prefix, section) {
    const envVars = Object.keys(process.env);
    
    const validConfigKeys = [
      'websocket_port', 'websocket_host', 'guacd_host', 'guacd_port',
      'log_level', 'max_inactivity_time', 'cypher', 'secret_key',
      'unencrypted_params', 'token_expiration_check', 'drive_path_template',
      'recordings_path', 'recordings_filename', 'recordings_compression_format',
      'recordings_storage', 'recordings_delete_local_after_upload',
      's3_region', 's3_access_key_id', 's3_secret_access_key', 's3_default_bucket',
      'webhook_enable', 'webhook_url'
    ];
    
    for (const envVar of envVars) {
      if (!envVar.startsWith(prefix)) continue;
      
      const fullKey = envVar.substring(prefix.length);
      const configKey = fullKey.toLowerCase();
      
      if (prefix === '' && !validConfigKeys.includes(configKey)) {
        continue;
      }
      
      const envValue = process.env[envVar];
      
      // For top-level configs, don't create nested objects from underscores
      if (prefix === '') {
        section[configKey] = this.convertType(envValue);
      } else {
        // For protocol-specific defaults, don't create nested objects from underscores
        // They should be treated as single keys like 'ignore-cert'
        section[configKey.replace(/_/g, '-')] = this.convertType(envValue);
      }
    }
  }

  validateConfig() {
    const required = ['websocket_port', 'guacd_host', 'guacd_port'];
    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
  }

  interpolateTemplate(template, data) {
    if (!template || typeof template !== 'string') return template;
    
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (key in data) {
        const value = data[key];
        if (typeof value === 'string') {
          return value.replace(/[/\\]/g, path.sep);
        }
        return value;
      }
      return match;
    });
  }

  getConfig() {
    return this.config;
  }
}

module.exports = ConfigLoader;