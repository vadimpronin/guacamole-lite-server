const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const Utils = require('./utils');

class S3Uploader {
  constructor(config) {
    this.config = config;
    this.s3 = null;
    this.initialized = false;
    
    this.initialize();
  }

  initialize() {
    if (!this.config.s3_access_key_id || !this.config.s3_secret_access_key) {
      console.warn('S3 credentials not provided, S3 upload disabled');
      return;
    }

    const s3Config = {
      accessKeyId: this.config.s3_access_key_id,
      secretAccessKey: this.config.s3_secret_access_key,
      region: this.config.s3_region || 'us-east-1'
    };

    if (this.config.s3_endpoint) {
      s3Config.endpoint = this.config.s3_endpoint;
      s3Config.s3ForcePathStyle = true;
    }

    this.s3 = new AWS.S3(s3Config);
    this.initialized = true;
  }

  isAvailable() {
    return this.initialized && this.s3;
  }

  async upload(filePath, connection) {
    if (!this.isAvailable()) {
      throw new Error('S3 uploader not initialized');
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const bucket = this.getBucket(connection);
    const key = this.generateS3Key(filePath, connection);

    const retryUpload = Utils.createRetryWrapper(
      this.performUpload.bind(this),
      3,
      2000
    );

    try {
      await retryUpload(bucket, key, filePath);
      console.log(`Successfully uploaded to S3: s3://${bucket}/${key}`);
      return key;
    } catch (error) {
      console.error('S3 upload failed after retries:', error);
      throw error;
    }
  }

  getBucket(connection) {
    if (connection.token?.s3?.bucket) {
      return connection.token.s3.bucket;
    }
    
    if (this.config.s3_default_bucket) {
      return this.config.s3_default_bucket;
    }
    
    throw new Error('No S3 bucket specified in token or configuration');
  }

  generateS3Key(filePath, connection) {
    const filename = path.basename(filePath);
    const meta = connection.token?.meta || {};
    
    let keyTemplate = this.config.s3_key_template;
    
    if (!keyTemplate) {
      if (meta.userId) {
        keyTemplate = `recordings/{{userId}}/${filename}`;
      } else {
        keyTemplate = `recordings/${filename}`;
      }
    }
    
    return keyTemplate.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (key === 'filename') return filename;
      if (meta[key]) return meta[key];
      return match;
    });
  }

  async performUpload(bucket, key, filePath) {
    const fileStream = fs.createReadStream(filePath);
    const stats = fs.statSync(filePath);
    
    const uploadParams = {
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentLength: stats.size,
      ContentType: this.getContentType(filePath)
    };

    if (stats.size > 100 * 1024 * 1024) {
      return this.multipartUpload(uploadParams);
    } else {
      return this.s3.upload(uploadParams).promise();
    }
  }

  async multipartUpload(uploadParams) {
    const upload = this.s3.upload(uploadParams, {
      partSize: 10 * 1024 * 1024,
      queueSize: 1
    });

    return new Promise((resolve, reject) => {
      upload.on('httpUploadProgress', (progress) => {
        const percent = Math.round((progress.loaded / progress.total) * 100);
        if (percent % 10 === 0) {
          console.log(`Upload progress: ${percent}%`);
        }
      });

      upload.send((err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case '.guac':
        return 'application/octet-stream';
      case '.gz':
        return 'application/gzip';
      case '.zip':
        return 'application/zip';
      default:
        return 'application/octet-stream';
    }
  }

  async createBucketIfNotExists(bucketName) {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.s3.headBucket({ Bucket: bucketName }).promise();
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        try {
          await this.s3.createBucket({ Bucket: bucketName }).promise();
          console.log(`Created S3 bucket: ${bucketName}`);
          return true;
        } catch (createError) {
          console.error('Failed to create S3 bucket:', createError);
          return false;
        }
      } else {
        console.error('Error checking S3 bucket:', error);
        return false;
      }
    }
  }

  async testConnection() {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.s3.listBuckets().promise();
      return true;
    } catch (error) {
      console.error('S3 connection test failed:', error);
      return false;
    }
  }
}

module.exports = S3Uploader;