const GuacamoleLite = require('guacamole-lite');
const ConfigLoader = require('./config-loader');
const RecordingManager = require('./recording-manager');
const S3Uploader = require('./s3-uploader');
const WebhookManager = require('./webhook-manager');
const Utils = require('./utils');

class GuacamoleLiteServer {
  constructor(configPath) {
    this.configLoader = new ConfigLoader(configPath);
    this.config = this.configLoader.load();
    this.server = null;
    this.connections = new Map();
    
    this.s3Uploader = new S3Uploader(this.config);
    this.recordingManager = new RecordingManager(this.config, this.s3Uploader);
    this.webhookManager = new WebhookManager(this.config);
    
    this.setupGuacamoleLiteConfig();
  }

  setupGuacamoleLiteConfig() {
    this.guacamoleConfig = {
      host: this.config.websocket_host || '0.0.0.0',
      port: this.config.websocket_port || 8080,
      guacdOptions: {
        host: this.config.guacd_host || '127.0.0.1',
        port: this.config.guacd_port || 4822
      },
      logLevel: this.config.log_level || 'NORMAL',
      maxInactivityTime: this.config.max_inactivity_time || 15000,
      cypher: this.config.cypher || 'AES-256-CBC',
      secretKey: this.config.secret_key,
      unencryptedParams: Array.isArray(this.config.unencrypted_params) 
        ? this.config.unencrypted_params 
        : (this.config.unencrypted_params ? this.config.unencrypted_params.split(',').map(s => s.trim()) : []),
      processConnectionSettings: this.processConnectionSettings.bind(this)
    };
  }

  async start() {
    console.log('Starting Guacamole Lite Server...');
    
    if (!this.config.secret_key) {
      throw new Error('SECRET_KEY is required for token decryption');
    }

    this.server = new GuacamoleLite(this.guacamoleConfig);
    
    this.setupEventHandlers();
    
    await this.server.start();
    
    console.log(`Server started on ${this.config.websocket_host}:${this.config.websocket_port}`);
    console.log(`Guacd connection: ${this.config.guacd_host}:${this.config.guacd_port}`);
    
    if (this.s3Uploader.isAvailable()) {
      console.log('S3 upload enabled');
    }
    
    if (this.webhookManager.isEnabled()) {
      console.log('Webhook notifications enabled');
    }
  }

  setupEventHandlers() {
    this.server.on('connection', (connection) => {
      console.log('New connection:', connection.connectionId);
      this.connections.set(connection.connectionId, connection);
      
      connection.on('open', (sessionId) => {
        console.log('Session opened:', sessionId);
        this.handleSessionOpen(connection, sessionId);
      });
      
      connection.on('close', (sessionId) => {
        console.log('Session closed:', sessionId);
        this.handleSessionClose(connection, sessionId);
      });
      
      connection.on('error', (error) => {
        console.error('Connection error:', error);
        this.handleConnectionError(connection, error);
      });
    });
  }

  async handleSessionOpen(connection, sessionId) {
    try {
      await this.webhookManager.sendSessionStarted(sessionId, connection);
      
      if (connection.token?.recording === true || this.config.recordings_enabled) {
        const recordingInfo = await this.recordingManager.handleRecordingStart(
          connection,
          sessionId
        );
        
        if (recordingInfo) {
          connection.recordingPath = recordingInfo.path;
          connection.recordingFilename = recordingInfo.filename;
          console.log('Recording started:', recordingInfo.filename);
        }
      }
    } catch (error) {
      console.error('Error handling session open:', error);
    }
  }

  async handleSessionClose(connection, sessionId) {
    try {
      await this.webhookManager.sendSessionEnded(sessionId, connection);
      
      if (connection.recordingPath) {
        console.log('Processing recording:', connection.recordingFilename);
        
        const processedPath = await this.recordingManager.handleRecordingEnd(
          connection.recordingPath,
          connection,
          sessionId
        );
        
        if (processedPath && this.config.recordings_storage === 's3') {
          const bucket = this.s3Uploader.getBucket(connection);
          const key = processedPath.replace(this.config.recordings_path, '').replace(/^\//, '');
          
          await this.webhookManager.sendRecordingSaved(sessionId, connection, bucket, key);
        }
      }
      
      this.connections.delete(connection.connectionId);
    } catch (error) {
      console.error('Error handling session close:', error);
    }
  }

  handleConnectionError(connection, error) {
    console.error(`Connection ${connection.connectionId} error:`, error);
    
    if (connection.recordingPath) {
      console.log('Cleaning up recording due to error');
    }
    
    this.connections.delete(connection.connectionId);
  }

  processConnectionSettings(token) {
    try {
      if (this.config.token_expiration_check && token.expiration) {
        const now = Date.now();
        const expiration = parseInt(token.expiration, 10);
        
        if (now > expiration) {
          throw new Error('Token has expired');
        }
      }
      
      const settings = Utils.createConnectionSettings(token, this.config);
      
      if (this.config.drive_path_template && settings.protocol === 'rdp') {
        settings['drive-path'] = this.configLoader.interpolateTemplate(
          this.config.drive_path_template,
          token.meta || {}
        );
      }
      
      return settings;
    } catch (error) {
      console.error('Error processing connection settings:', error);
      throw error;
    }
  }

  async stop() {
    console.log('Stopping Guacamole Lite Server...');
    
    if (this.server) {
      await this.server.stop();
    }
    
    for (const connection of this.connections.values()) {
      try {
        if (connection.close) {
          connection.close();
        }
      } catch (error) {
        console.error('Error closing connection:', error);
      }
    }
    
    await this.recordingManager.cleanup();
    await this.webhookManager.cleanup();
    
    console.log('Server stopped');
  }

  getStatus() {
    return {
      running: this.server ? this.server.isRunning() : false,
      connections: this.connections.size,
      s3Available: this.s3Uploader.isAvailable(),
      webhookEnabled: this.webhookManager.isEnabled(),
      webhookQueue: this.webhookManager.getQueueStatus()
    };
  }
}

module.exports = GuacamoleLiteServer;