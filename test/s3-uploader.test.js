const S3Uploader = require('../lib/s3-uploader');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

jest.mock('aws-sdk', () => {
  const mockS3 = {
    upload: jest.fn(),
    headBucket: jest.fn(),
    createBucket: jest.fn(),
    listBuckets: jest.fn()
  };
  
  return {
    S3: jest.fn(() => mockS3)
  };
});

jest.mock('fs');

describe('S3Uploader', () => {
  let s3Uploader;
  let mockS3Instance;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Instance = new AWS.S3();
  });

  describe('initialize()', () => {
    test('should initialize with valid credentials', () => {
      const config = {
        s3_access_key_id: 'test-key',
        s3_secret_access_key: 'test-secret',
        s3_region: 'us-east-1'
      };
      
      s3Uploader = new S3Uploader(config);
      
      expect(s3Uploader.isAvailable()).toBe(true);
      expect(AWS.S3).toHaveBeenCalledWith({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'us-east-1'
      });
    });

    test('should handle custom S3 endpoint', () => {
      const config = {
        s3_access_key_id: 'test-key',
        s3_secret_access_key: 'test-secret',
        s3_endpoint: 'http://localhost:9000'
      };
      
      s3Uploader = new S3Uploader(config);
      
      expect(AWS.S3).toHaveBeenCalledWith(expect.objectContaining({
        endpoint: 'http://localhost:9000',
        s3ForcePathStyle: true
      }));
    });

    test('should not initialize without credentials', () => {
      const config = {};
      
      s3Uploader = new S3Uploader(config);
      
      expect(s3Uploader.isAvailable()).toBe(false);
      expect(AWS.S3).not.toHaveBeenCalled();
    });
  });

  describe('upload()', () => {
    beforeEach(() => {
      const config = {
        s3_access_key_id: 'test-key',
        s3_secret_access_key: 'test-secret',
        s3_default_bucket: 'test-bucket'
      };
      s3Uploader = new S3Uploader(config);
      
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: 1024 });
      fs.createReadStream.mockReturnValue('mock-stream');
    });

    test('should upload file successfully', async () => {
      const mockUpload = {
        promise: jest.fn().mockResolvedValue({ Key: 'test-key' })
      };
      mockS3Instance.upload.mockReturnValue(mockUpload);
      
      const connection = { token: { meta: { userId: '123' } } };
      const result = await s3Uploader.upload('/path/to/file.guac', connection);
      
      expect(mockS3Instance.upload).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'test-bucket',
        Body: 'mock-stream'
      }));
      expect(result).toMatch(/recordings\/123\/file\.guac/);
    });

    test('should throw error if S3 not initialized', async () => {
      s3Uploader = new S3Uploader({});
      
      await expect(s3Uploader.upload('/path/to/file.guac', {}))
        .rejects.toThrow('S3 uploader not initialized');
    });

    test('should throw error if file not found', async () => {
      fs.existsSync.mockReturnValue(false);
      
      await expect(s3Uploader.upload('/non/existent/file', {}))
        .rejects.toThrow('File not found');
    });

    test('should use token bucket over default bucket', async () => {
      const mockUpload = {
        promise: jest.fn().mockResolvedValue({ Key: 'test-key' })
      };
      mockS3Instance.upload.mockReturnValue(mockUpload);
      
      const connection = {
        token: {
          s3: { bucket: 'custom-bucket' },
          meta: { userId: '123' }
        }
      };
      
      await s3Uploader.upload('/path/to/file.guac', connection);
      
      expect(mockS3Instance.upload).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'custom-bucket'
      }));
    });
  });

  describe('generateS3Key()', () => {
    beforeEach(() => {
      const config = {
        s3_access_key_id: 'test-key',
        s3_secret_access_key: 'test-secret'
      };
      s3Uploader = new S3Uploader(config);
    });

    test('should generate S3 key with template', () => {
      s3Uploader.config.s3_key_template = 'recordings/{{userId}}/{{sessionId}}/{{filename}}';
      
      const connection = {
        token: {
          meta: {
            userId: 'user123',
            sessionId: 'sess456'
          }
        }
      };
      
      const key = s3Uploader.generateS3Key('/path/to/test.guac', connection);
      
      expect(key).toBe('recordings/user123/sess456/test.guac');
    });

    test('should use default template when not configured', () => {
      const connection = {
        token: {
          meta: { userId: 'user123' }
        }
      };
      
      const key = s3Uploader.generateS3Key('/path/to/test.guac', connection);
      
      expect(key).toBe('recordings/user123/test.guac');
    });

    test('should handle missing metadata', () => {
      const connection = { token: {} };
      
      const key = s3Uploader.generateS3Key('/path/to/test.guac', connection);
      
      expect(key).toBe('recordings/test.guac');
    });
  });

  describe('getContentType()', () => {
    beforeEach(() => {
      s3Uploader = new S3Uploader({});
    });

    test('should return correct content types', () => {
      expect(s3Uploader.getContentType('file.guac')).toBe('application/octet-stream');
      expect(s3Uploader.getContentType('file.gz')).toBe('application/gzip');
      expect(s3Uploader.getContentType('file.zip')).toBe('application/zip');
      expect(s3Uploader.getContentType('file.unknown')).toBe('application/octet-stream');
    });
  });

  describe('testConnection()', () => {
    beforeEach(() => {
      const config = {
        s3_access_key_id: 'test-key',
        s3_secret_access_key: 'test-secret'
      };
      s3Uploader = new S3Uploader(config);
    });

    test('should return true on successful connection', async () => {
      mockS3Instance.listBuckets.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      });
      
      const result = await s3Uploader.testConnection();
      
      expect(result).toBe(true);
      expect(mockS3Instance.listBuckets).toHaveBeenCalled();
    });

    test('should return false on connection failure', async () => {
      mockS3Instance.listBuckets.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('Connection failed'))
      });
      
      const result = await s3Uploader.testConnection();
      
      expect(result).toBe(false);
    });

    test('should return false if not initialized', async () => {
      s3Uploader = new S3Uploader({});
      
      const result = await s3Uploader.testConnection();
      
      expect(result).toBe(false);
    });
  });

  describe('createBucketIfNotExists()', () => {
    beforeEach(() => {
      const config = {
        s3_access_key_id: 'test-key',
        s3_secret_access_key: 'test-secret'
      };
      s3Uploader = new S3Uploader(config);
    });

    test('should return true if bucket exists', async () => {
      mockS3Instance.headBucket.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      });
      
      const result = await s3Uploader.createBucketIfNotExists('test-bucket');
      
      expect(result).toBe(true);
      expect(mockS3Instance.headBucket).toHaveBeenCalledWith({ Bucket: 'test-bucket' });
    });

    test('should create bucket if not exists', async () => {
      const error = new Error('Not found');
      error.statusCode = 404;
      
      mockS3Instance.headBucket.mockReturnValue({
        promise: jest.fn().mockRejectedValue(error)
      });
      
      mockS3Instance.createBucket.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      });
      
      const result = await s3Uploader.createBucketIfNotExists('test-bucket');
      
      expect(result).toBe(true);
      expect(mockS3Instance.createBucket).toHaveBeenCalledWith({ Bucket: 'test-bucket' });
    });

    test('should return false on other errors', async () => {
      mockS3Instance.headBucket.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('Access denied'))
      });
      
      const result = await s3Uploader.createBucketIfNotExists('test-bucket');
      
      expect(result).toBe(false);
    });
  });
});