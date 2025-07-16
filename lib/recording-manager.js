const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const zlib = require('zlib');
const Utils = require('./utils');
const { promisify } = require('util');

class RecordingManager {
  constructor(config, s3Uploader) {
    this.config = config;
    this.s3Uploader = s3Uploader;
    this.uploadQueue = [];
    this.processing = false;
  }

  async handleRecordingStart(connection, sessionId) {
    try {
      const filename = this.generateRecordingFilename(connection, sessionId);
      const fullPath = path.join(this.config.recordings_path, filename);
      
      await Utils.ensureDirectoryExists(fullPath);
      
      return {
        path: fullPath,
        filename: filename
      };
    } catch (error) {
      console.error('Failed to start recording:', error);
      return null;
    }
  }

  async handleRecordingEnd(recordingPath, connection, sessionId) {
    if (!recordingPath || !fs.existsSync(recordingPath)) {
      console.warn('Recording file not found:', recordingPath);
      return null;
    }

    try {
      const compressedPath = await this.compressRecording(recordingPath);
      
      if (this.config.recordings_storage === 's3' && this.s3Uploader) {
        this.queueForUpload(compressedPath, connection, sessionId);
      }
      
      return compressedPath;
    } catch (error) {
      console.error('Failed to process recording:', error);
      return null;
    }
  }

  generateRecordingFilename(connection, sessionId) {
    const template = this.config.recordings_filename || 'session-{{sessionId}}-{{timestamp}}.guac';
    
    const data = {
      sessionId: sessionId,
      connectionId: connection.connectionId || 'unknown',
      userId: connection.token?.meta?.userId || 'anonymous',
      ...connection.token?.meta
    };
    
    const filename = Utils.generateFilename(template, data);
    const extension = Utils.getFileExtensionForCompression(this.config.recordings_compression_format);
    
    return filename + extension;
  }

  async compressRecording(inputPath) {
    const format = this.config.recordings_compression_format || 'none';
    
    if (format === 'none') {
      return inputPath;
    }
    
    const outputPath = inputPath + Utils.getFileExtensionForCompression(format);
    
    try {
      if (format === 'gzip') {
        await this.compressWithGzip(inputPath, outputPath);
      } else if (format === 'zip') {
        await this.compressWithZip(inputPath, outputPath);
      }
      
      if (fs.existsSync(outputPath)) {
        await promisify(fs.unlink)(inputPath);
        return outputPath;
      }
    } catch (error) {
      console.error('Compression failed:', error);
    }
    
    return inputPath;
  }

  async compressWithGzip(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(inputPath);
      const writeStream = fs.createWriteStream(outputPath);
      const gzip = zlib.createGzip();
      
      readStream.pipe(gzip).pipe(writeStream);
      
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      readStream.on('error', reject);
      gzip.on('error', reject);
    });
  }

  async compressWithZip(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip');
      
      output.on('close', resolve);
      archive.on('error', reject);
      
      archive.pipe(output);
      archive.file(inputPath, { name: path.basename(inputPath) });
      archive.finalize();
    });
  }

  queueForUpload(filePath, connection, sessionId) {
    this.uploadQueue.push({
      filePath,
      connection,
      sessionId,
      attempts: 0,
      maxAttempts: 3
    });
    
    this.processUploadQueue();
  }

  async processUploadQueue() {
    if (this.processing || this.uploadQueue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    while (this.uploadQueue.length > 0) {
      const upload = this.uploadQueue.shift();
      
      try {
        await this.uploadRecording(upload);
      } catch (error) {
        console.error('Upload failed:', error);
        
        upload.attempts++;
        if (upload.attempts < upload.maxAttempts) {
          this.uploadQueue.push(upload);
          await new Promise(resolve => setTimeout(resolve, 5000 * upload.attempts));
        } else {
          console.error('Max upload attempts reached for:', upload.filePath);
        }
      }
    }
    
    this.processing = false;
  }

  async uploadRecording(upload) {
    if (!this.s3Uploader) {
      throw new Error('S3 uploader not available');
    }
    
    const s3Key = await this.s3Uploader.upload(upload.filePath, upload.connection);
    
    if (this.config.recordings_delete_local_after_upload) {
      try {
        await promisify(fs.unlink)(upload.filePath);
      } catch (error) {
        console.warn('Failed to delete local recording file:', error);
      }
    }
    
    return s3Key;
  }

  async cleanup() {
    while (this.uploadQueue.length > 0 && this.processing) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

module.exports = RecordingManager;