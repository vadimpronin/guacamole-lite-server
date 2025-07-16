const Utils = require('../lib/utils');
const path = require('path');

describe('Utils', () => {
  describe('sanitizePath()', () => {
    test('should accept valid paths', () => {
      expect(Utils.sanitizePath('/data/recordings/test.guac')).toBe('/data/recordings/test.guac');
      expect(Utils.sanitizePath('recordings/test.guac')).toBe('recordings/test.guac');
    });

    test('should reject path traversal attempts', () => {
      expect(() => Utils.sanitizePath('../etc/passwd')).toThrow('Path traversal not allowed');
      expect(() => Utils.sanitizePath('/data/../../../etc/passwd')).toThrow('Path traversal not allowed');
    });

    test('should reject invalid inputs', () => {
      expect(() => Utils.sanitizePath(null)).toThrow('Invalid path');
      expect(() => Utils.sanitizePath(123)).toThrow('Invalid path');
      expect(() => Utils.sanitizePath('')).toThrow('Invalid path');
    });
  });

  describe('generateFilename()', () => {
    test('should generate filename with placeholders', () => {
      const template = '{{userId}}/session-{{sessionId}}-{{timestamp}}.guac';
      const data = {
        userId: 'user123',
        sessionId: 'sess456'
      };
      
      const filename = Utils.generateFilename(template, data);
      
      expect(filename).toMatch(/user123\/session-sess456-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.guac/);
    });

    test('should handle missing template', () => {
      expect(Utils.generateFilename(null, {})).toBe('recording.guac');
      expect(Utils.generateFilename('', {})).toBe('recording.guac');
    });

    test('should handle missing data gracefully', () => {
      const template = '{{userId}}/{{missing}}.guac';
      const filename = Utils.generateFilename(template, { userId: 'test' });
      
      expect(filename).toMatch(/test\/\{\{missing\}\}\.guac/);
    });
  });

  describe('sanitizeWebhookPayload()', () => {
    test('should remove sensitive fields', () => {
      const data = {
        username: 'user',
        password: 'secret123',
        token: 'abc123',
        meta: {
          userId: '123',
          api_key: 'key123'
        }
      };
      
      const sanitized = Utils.sanitizeWebhookPayload(data);
      
      expect(sanitized.username).toBe('user');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.meta.userId).toBe('123');
      expect(sanitized.meta.api_key).toBe('[REDACTED]');
    });

    test('should handle null and non-object inputs', () => {
      expect(Utils.sanitizeWebhookPayload(null)).toBe(null);
      expect(Utils.sanitizeWebhookPayload('string')).toBe('string');
      expect(Utils.sanitizeWebhookPayload(123)).toBe(123);
    });

    test('should handle nested objects', () => {
      const data = {
        level1: {
          level2: {
            secret: 'hidden',
            public: 'visible'
          }
        }
      };
      
      const sanitized = Utils.sanitizeWebhookPayload(data);
      
      expect(sanitized.level1.level2.secret).toBe('[REDACTED]');
      expect(sanitized.level1.level2.public).toBe('visible');
    });
  });

  describe('createRetryWrapper()', () => {
    test('should retry on failure', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Test error');
        }
        return 'success';
      });
      
      const wrapped = Utils.createRetryWrapper(fn, 3, 10);
      const result = await wrapped();
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('should throw after max retries', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Always fails');
      });
      
      const wrapped = Utils.createRetryWrapper(fn, 2, 10);
      
      await expect(wrapped()).rejects.toThrow('Always fails');
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    test('should succeed on first attempt', async () => {
      const fn = jest.fn(async () => 'immediate success');
      
      const wrapped = Utils.createRetryWrapper(fn, 3, 10);
      const result = await wrapped();
      
      expect(result).toBe('immediate success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('getFileExtensionForCompression()', () => {
    test('should return correct extensions', () => {
      expect(Utils.getFileExtensionForCompression('gzip')).toBe('.gz');
      expect(Utils.getFileExtensionForCompression('zip')).toBe('.zip');
      expect(Utils.getFileExtensionForCompression('none')).toBe('');
      expect(Utils.getFileExtensionForCompression('invalid')).toBe('');
    });
  });

  describe('isValidUrl()', () => {
    test('should validate URLs correctly', () => {
      expect(Utils.isValidUrl('http://example.com')).toBe(true);
      expect(Utils.isValidUrl('https://example.com:8080/path')).toBe(true);
      expect(Utils.isValidUrl('ws://localhost:8080')).toBe(true);
      
      expect(Utils.isValidUrl('not-a-url')).toBe(false);
      expect(Utils.isValidUrl('http://')).toBe(false);
      expect(Utils.isValidUrl('')).toBe(false);
    });
  });

  describe('parseConnectionId()', () => {
    test('should parse valid connection IDs', () => {
      expect(Utils.parseConnectionId('conn-123')).toBe('conn-123');
      expect(Utils.parseConnectionId('abc123')).toBe('abc123');
    });

    test('should handle invalid inputs', () => {
      expect(Utils.parseConnectionId(null)).toBe(null);
      expect(Utils.parseConnectionId(123)).toBe(null);
      expect(Utils.parseConnectionId('')).toBe(null);
    });
  });

  describe('createConnectionSettings()', () => {
    test('should merge token with defaults', () => {
      const token = {
        protocol: 'rdp',
        hostname: '192.168.1.1',
        meta: { userId: '123' }
      };
      
      const config = {
        defaults: {
          all: { width: 1024, height: 768 },
          rdp: { security: 'any' }
        }
      };
      
      const settings = Utils.createConnectionSettings(token, config);
      
      expect(settings.protocol).toBe('rdp');
      expect(settings.hostname).toBe('192.168.1.1');
      expect(settings.width).toBe(1024);
      expect(settings.height).toBe(768);
      expect(settings.security).toBe('any');
    });

    test('should apply drive path template for RDP', () => {
      const token = {
        protocol: 'rdp',
        meta: { userId: '123' }
      };
      
      const config = {
        drive_path_template: '/drives/{{userId}}'
      };
      
      const settings = Utils.createConnectionSettings(token, config);
      
      expect(settings['drive-path']).toBe('/drives/123');
    });

    test('should handle missing config sections', () => {
      const token = { protocol: 'vnc' };
      const config = {};
      
      const settings = Utils.createConnectionSettings(token, config);
      
      expect(settings.protocol).toBe('vnc');
    });
  });
});