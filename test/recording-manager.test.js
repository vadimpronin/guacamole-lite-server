const RecordingManager = require('../lib/recording-manager');
const S3Uploader = require('../lib/s3-uploader');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const archiver = require('archiver');
const { promisify } = require('util');

jest.mock('fs');
jest.mock('zlib');
jest.mock('archiver');
jest.mock('../lib/s3-uploader');

describe('RecordingManager', () => {
  let recordingManager;
  let mockS3Uploader;
  let config;

  beforeEach(() => {
    jest.clearAllMocks();
    
    config = {
      recordings_path: '/data/recordings',
      recordings_filename: '{{userId}}/session-{{sessionId}}-{{timestamp}}.guac',
      recordings_compression_format: 'gzip',
      recordings_storage: 's3',
      recordings_delete_local_after_upload: true
    };
    
    mockS3Uploader = {
      upload: jest.fn().mockResolvedValue('s3://bucket/key'),
      isAvailable: jest.fn().mockReturnValue(true)
    };
    
    recordingManager = new RecordingManager(config, mockS3Uploader);
  });

  describe('handleRecordingStart()', () => {
    test('should generate recording path and filename', async () => {
      const connection = {
        connectionId: 'conn-123',
        token: { meta: { userId: 'user123' } }
      };
      
      fs.existsSync.mockReturnValue(true);
      
      const result = await recordingManager.handleRecordingStart(connection, 'session-456');
      
      expect(result).toMatchObject({
        path: expect.stringMatching(/\/data\/recordings\/user123\/session-session-456-.*\.guac\.gz/),
        filename: expect.stringMatching(/user123\/session-session-456-.*\.guac\.gz/)
      });
    });

    test('should handle errors gracefully', async () => {
      const connection = {};
      
      const result = await recordingManager.handleRecordingStart(connection, 'session-456');
      
      expect(result).toBe(null);
    });
  });

  describe('handleRecordingEnd()', () => {
    beforeEach(() => {
      fs.existsSync.mockReturnValue(true);
      fs.createReadStream.mockReturnValue('mock-read-stream');
      fs.createWriteStream.mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'finish') setTimeout(cb, 0);
        })
      });
    });

    test('should compress and queue recording for upload', async () => {
      const recordingPath = '/data/recordings/test.guac';
      const connection = { token: { meta: { userId: 'user123' } } };
      
      const mockGzip = {
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn()
      };
      zlib.createGzip.mockReturnValue(mockGzip);
      
      const result = await recordingManager.handleRecordingEnd(recordingPath, connection, 'session-123');
      
      expect(result).toBe(recordingPath + '.gz');
      expect(recordingManager.uploadQueue.length).toBe(1);
    });

    test('should handle missing recording file', async () => {
      fs.existsSync.mockReturnValue(false);
      
      const result = await recordingManager.handleRecordingEnd('/missing/file.guac', {}, 'session-123');
      
      expect(result).toBe(null);
    });

    test('should skip upload for local storage', async () => {
      config.recordings_storage = 'local';
      recordingManager = new RecordingManager(config, mockS3Uploader);
      
      const result = await recordingManager.handleRecordingEnd('/data/recordings/test.guac', {}, 'session-123');
      
      expect(recordingManager.uploadQueue.length).toBe(0);
    });
  });

  describe('compressRecording()', () => {
    test('should skip compression when format is none', async () => {
      config.recordings_compression_format = 'none';
      recordingManager = new RecordingManager(config, mockS3Uploader);
      
      const inputPath = '/data/recordings/test.guac';
      const result = await recordingManager.compressRecording(inputPath);
      
      expect(result).toBe(inputPath);
      expect(zlib.createGzip).not.toHaveBeenCalled();
    });

    test('should compress with gzip', async () => {
      const inputPath = '/data/recordings/test.guac';
      const outputPath = inputPath + '.gz';
      
      fs.existsSync.mockReturnValue(true);
      fs.createReadStream.mockReturnValue({ 
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn()
      });
      fs.createWriteStream.mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'finish') setTimeout(cb, 0);
        })
      });
      fs.unlink = jest.fn((path, cb) => cb());
      
      const mockGzip = {
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn()
      };
      zlib.createGzip.mockReturnValue(mockGzip);
      
      const result = await recordingManager.compressRecording(inputPath);
      
      expect(result).toBe(outputPath);
      expect(zlib.createGzip).toHaveBeenCalled();
    });

    test('should compress with zip', async () => {
      config.recordings_compression_format = 'zip';
      recordingManager = new RecordingManager(config, mockS3Uploader);
      
      const inputPath = '/data/recordings/test.guac';
      const outputPath = inputPath + '.zip';
      
      fs.existsSync.mockReturnValue(true);
      fs.createWriteStream.mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'close') setTimeout(cb, 0);
        })
      });
      fs.unlink = jest.fn((path, cb) => cb());
      
      const mockArchive = {
        pipe: jest.fn(),
        file: jest.fn(),
        finalize: jest.fn(),
        on: jest.fn()
      };
      archiver.mockReturnValue(mockArchive);
      
      const result = await recordingManager.compressRecording(inputPath);
      
      expect(result).toBe(outputPath);
      expect(archiver).toHaveBeenCalledWith('zip');
      expect(mockArchive.file).toHaveBeenCalledWith(inputPath, { name: 'test.guac' });
    });
  });

  describe('processUploadQueue()', () => {
    test('should process queued uploads', async () => {
      const upload = {
        filePath: '/data/recordings/test.guac.gz',
        connection: { token: { meta: { userId: 'user123' } } },
        sessionId: 'session-123',
        attempts: 0,
        maxAttempts: 3
      };
      
      recordingManager.uploadQueue.push(upload);
      
      await recordingManager.processUploadQueue();
      
      expect(mockS3Uploader.upload).toHaveBeenCalledWith(
        upload.filePath,
        upload.connection
      );
      expect(recordingManager.uploadQueue.length).toBe(0);
    });

    test('should retry failed uploads', async () => {
      mockS3Uploader.upload.mockRejectedValueOnce(new Error('Network error'))
                             .mockResolvedValueOnce('s3://bucket/key');
      
      const upload = {
        filePath: '/data/recordings/test.guac.gz',
        connection: {},
        sessionId: 'session-123',
        attempts: 0,
        maxAttempts: 3
      };
      
      recordingManager.uploadQueue.push(upload);
      
      await recordingManager.processUploadQueue();
      
      expect(upload.attempts).toBe(1);
      expect(recordingManager.uploadQueue.length).toBe(1);
    });

    test('should stop retrying after max attempts', async () => {
      mockS3Uploader.upload.mockRejectedValue(new Error('Always fails'));
      
      const upload = {
        filePath: '/data/recordings/test.guac.gz',
        connection: {},
        sessionId: 'session-123',
        attempts: 2,
        maxAttempts: 3
      };
      
      recordingManager.uploadQueue.push(upload);
      
      await recordingManager.processUploadQueue();
      
      expect(recordingManager.uploadQueue.length).toBe(0);
    });
  });

  describe('uploadRecording()', () => {
    test('should delete local file after successful upload', async () => {
      config.recordings_delete_local_after_upload = true;
      recordingManager = new RecordingManager(config, mockS3Uploader);
      
      fs.unlink = jest.fn((path, cb) => cb());
      
      const upload = {
        filePath: '/data/recordings/test.guac.gz',
        connection: {}
      };
      
      await recordingManager.uploadRecording(upload);
      
      expect(mockS3Uploader.upload).toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalledWith(upload.filePath, expect.any(Function));
    });

    test('should keep local file if configured', async () => {
      config.recordings_delete_local_after_upload = false;
      recordingManager = new RecordingManager(config, mockS3Uploader);
      
      fs.unlink = jest.fn();
      
      const upload = {
        filePath: '/data/recordings/test.guac.gz',
        connection: {}
      };
      
      await recordingManager.uploadRecording(upload);
      
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    test('should throw error if S3 uploader not available', async () => {
      recordingManager = new RecordingManager(config, null);
      
      const upload = {
        filePath: '/data/recordings/test.guac.gz',
        connection: {}
      };
      
      await expect(recordingManager.uploadRecording(upload))
        .rejects.toThrow('S3 uploader not available');
    });
  });

  describe('generateRecordingFilename()', () => {
    test('should generate filename with all metadata', () => {
      const connection = {
        connectionId: 'conn-123',
        token: {
          meta: {
            userId: 'user123',
            customField: 'value'
          }
        }
      };
      
      const filename = recordingManager.generateRecordingFilename(connection, 'session-456');
      
      expect(filename).toMatch(/user123\/session-session-456-.*\.guac\.gz/);
    });

    test('should handle missing metadata', () => {
      const connection = {};
      
      const filename = recordingManager.generateRecordingFilename(connection, 'session-456');
      
      expect(filename).toMatch(/anonymous\/session-session-456-.*\.guac\.gz/);
    });

    test('should apply correct compression extension', () => {
      config.recordings_compression_format = 'zip';
      recordingManager = new RecordingManager(config, mockS3Uploader);
      
      const connection = {};
      const filename = recordingManager.generateRecordingFilename(connection, 'session-456');
      
      expect(filename).toMatch(/\.guac\.zip$/);
    });
  });

  describe('cleanup()', () => {
    test('should wait for pending uploads', async () => {
      recordingManager.processing = true;
      recordingManager.uploadQueue.push({ test: 'item' });
      
      setTimeout(() => {
        recordingManager.processing = false;
        recordingManager.uploadQueue = [];
      }, 100);
      
      await recordingManager.cleanup();
      
      expect(recordingManager.uploadQueue.length).toBe(0);
    });
  });
});