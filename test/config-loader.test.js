const path = require('path');
const fs = require('fs');
const ConfigLoader = require('../lib/config-loader');

describe('ConfigLoader', () => {
  let tempConfigPath;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    tempConfigPath = path.join(__dirname, 'test-config.ini');
  });

  afterEach(() => {
    process.env = originalEnv;
    if (fs.existsSync(tempConfigPath)) {
      fs.unlinkSync(tempConfigPath);
    }
  });

  describe('load()', () => {
    test('should load configuration from INI file', () => {
      const configContent = `
websocket_port = 8080
guacd_host = localhost
guacd_port = 4822
secret_key = test-secret-key
      `;
      fs.writeFileSync(tempConfigPath, configContent);

      const loader = new ConfigLoader(tempConfigPath);
      const config = loader.load();

      expect(config.websocket_port).toBe(8080);
      expect(config.guacd_host).toBe('localhost');
      expect(config.guacd_port).toBe(4822);
      expect(config.secret_key).toBe('test-secret-key');
    });

    test('should handle missing configuration file', () => {
      const loader = new ConfigLoader('/non/existent/path.ini');
      
      // Should throw because required config is missing
      expect(() => loader.load()).toThrow('Missing required configuration');
    });

    test('should parse nested sections', () => {
      const configContent = `
websocket_port = 8080
guacd_host = localhost
guacd_port = 4822

[defaults.all]
width = 1024
height = 768

[defaults.rdp]
security = any
ignore-cert = true
      `;
      fs.writeFileSync(tempConfigPath, configContent);

      const loader = new ConfigLoader(tempConfigPath);
      const config = loader.load();

      expect(config.defaults.all.width).toBe(1024);
      expect(config.defaults.all.height).toBe(768);
      expect(config.defaults.rdp.security).toBe('any');
      expect(config.defaults.rdp['ignore-cert']).toBe(true);
    });
  });

  describe('convertType()', () => {
    test('should convert boolean strings', () => {
      const loader = new ConfigLoader(tempConfigPath);
      
      expect(loader.convertType('true')).toBe(true);
      expect(loader.convertType('false')).toBe(false);
    });

    test('should convert numeric strings', () => {
      const loader = new ConfigLoader(tempConfigPath);
      
      expect(loader.convertType('123')).toBe(123);
      expect(loader.convertType('3.14')).toBe(3.14);
    });

    test('should convert comma-separated strings to arrays', () => {
      const loader = new ConfigLoader(tempConfigPath);
      
      expect(loader.convertType('a,b,c')).toEqual(['a', 'b', 'c']);
      expect(loader.convertType('width, height, dpi')).toEqual(['width', 'height', 'dpi']);
    });

    test('should preserve regular strings', () => {
      const loader = new ConfigLoader(tempConfigPath);
      
      expect(loader.convertType('some-string')).toBe('some-string');
    });
  });

  describe('mergeEnvironmentVariables()', () => {
    test('should override config with environment variables', () => {
      const configContent = `
websocket_port = 8080
guacd_host = localhost
guacd_port = 4822
secret_key = original-key
      `;
      fs.writeFileSync(tempConfigPath, configContent);

      process.env.WEBSOCKET_PORT = '9090';
      process.env.SECRET_KEY = 'env-secret-key';

      const loader = new ConfigLoader(tempConfigPath);
      const config = loader.load();

      expect(config.websocket_port).toBe(9090);
      expect(config.secret_key).toBe('env-secret-key');
    });

    test('should handle protocol-specific environment variables', () => {
      const configContent = `
websocket_port = 8080
guacd_host = localhost
guacd_port = 4822

[defaults.rdp]
security = any
      `;
      fs.writeFileSync(tempConfigPath, configContent);

      process.env.DEFAULTS_RDP_SECURITY = 'nla';
      process.env.DEFAULTS_RDP_IGNORE_CERT = 'true';

      const loader = new ConfigLoader(tempConfigPath);
      const config = loader.load();

      expect(config.defaults.rdp.security).toBe('nla');
      expect(config.defaults.rdp['ignore-cert']).toBe(true);
    });

    test('should ignore irrelevant environment variables', () => {
      const configContent = `
websocket_port = 8080
guacd_host = localhost
guacd_port = 4822
      `;
      fs.writeFileSync(tempConfigPath, configContent);

      process.env.TERM = 'xterm-256color';
      process.env.PATH = '/usr/bin';

      const loader = new ConfigLoader(tempConfigPath);
      const config = loader.load();

      expect(config.term).toBeUndefined();
      expect(config.path).toBeUndefined();
    });
  });

  describe('validateConfig()', () => {
    test('should throw error for missing required fields', () => {
      const configContent = `secret_key = test`;
      fs.writeFileSync(tempConfigPath, configContent);

      const loader = new ConfigLoader(tempConfigPath);
      
      expect(() => loader.load()).toThrow('Missing required configuration');
    });

    test('should pass validation with all required fields', () => {
      const configContent = `
websocket_port = 8080
guacd_host = localhost
guacd_port = 4822
      `;
      fs.writeFileSync(tempConfigPath, configContent);

      const loader = new ConfigLoader(tempConfigPath);
      expect(() => loader.load()).not.toThrow();
    });
  });

  describe('interpolateTemplate()', () => {
    test('should interpolate template strings', () => {
      const loader = new ConfigLoader(tempConfigPath);
      const template = '/data/drives/{{userId}}/session-{{sessionId}}';
      const data = { userId: '123', sessionId: 'abc' };
      
      const result = loader.interpolateTemplate(template, data);
      
      expect(result).toBe('/data/drives/123/session-abc');
    });

    test('should handle missing data gracefully', () => {
      const loader = new ConfigLoader(tempConfigPath);
      const template = '{{userId}}/{{missing}}';
      const data = { userId: '123' };
      
      const result = loader.interpolateTemplate(template, data);
      
      expect(result).toBe('123/{{missing}}');
    });

    test('should handle non-string templates', () => {
      const loader = new ConfigLoader(tempConfigPath);
      
      expect(loader.interpolateTemplate(null, {})).toBe(null);
      expect(loader.interpolateTemplate(123, {})).toBe(123);
    });
  });
});