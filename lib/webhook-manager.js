const axios = require('axios');
const Utils = require('./utils');

class WebhookManager {
  constructor(config) {
    this.config = config;
    this.queue = [];
    this.processing = false;
    this.enabled = !!(config.webhook_enable && config.webhook_url);
  }

  isEnabled() {
    return this.enabled === true;
  }

  async sendSessionStarted(sessionId, connection) {
    if (!this.isEnabled()) return;

    const payload = {
      event: 'session_started',
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      token_meta: Utils.sanitizeWebhookPayload(connection.token?.meta || {})
    };

    this.queueWebhook(payload);
  }

  async sendSessionEnded(sessionId, connection) {
    if (!this.isEnabled()) return;

    const payload = {
      event: 'session_ended',
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      token_meta: Utils.sanitizeWebhookPayload(connection.token?.meta || {})
    };

    this.queueWebhook(payload);
  }

  async sendRecordingSaved(sessionId, connection, bucket, key) {
    if (!this.isEnabled()) return;

    const payload = {
      event: 'recording_saved',
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      token_meta: Utils.sanitizeWebhookPayload(connection.token?.meta || {}),
      recording: {
        bucket: bucket,
        key: key
      }
    };

    this.queueWebhook(payload);
  }

  queueWebhook(payload) {
    this.queue.push({
      payload,
      attempts: 0,
      maxAttempts: 3,
      nextRetry: Date.now()
    });

    this.processQueue();
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const webhook = this.queue.shift();

      if (webhook.nextRetry > Date.now()) {
        this.queue.unshift(webhook);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      try {
        await this.sendWebhook(webhook.payload);
        console.log('Webhook sent successfully:', webhook.payload.event);
      } catch (error) {
        console.error('Webhook failed:', error.message);
        
        webhook.attempts++;
        
        if (webhook.attempts < webhook.maxAttempts) {
          const backoffDelay = Math.min(
            1000 * Math.pow(2, webhook.attempts),
            30000
          );
          webhook.nextRetry = Date.now() + backoffDelay;
          this.queue.push(webhook);
        } else {
          console.error('Max webhook attempts reached for:', webhook.payload.event);
        }
      }
    }

    this.processing = false;
  }

  async sendWebhook(payload) {
    const options = {
      method: 'POST',
      url: this.config.webhook_url,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'guacamole-lite-server/1.0.0'
      },
      data: payload,
      timeout: 10000,
      maxRedirects: 3
    };

    if (this.config.webhook_headers) {
      Object.assign(options.headers, this.config.webhook_headers);
    }

    if (this.config.webhook_auth_type === 'bearer' && this.config.webhook_auth_token) {
      options.headers.Authorization = `Bearer ${this.config.webhook_auth_token}`;
    } else if (this.config.webhook_auth_type === 'basic' && this.config.webhook_auth_username && this.config.webhook_auth_password) {
      options.auth = {
        username: this.config.webhook_auth_username,
        password: this.config.webhook_auth_password
      };
    }

    const response = await axios(options);
    
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.data;
  }

  async testWebhook() {
    if (!this.isEnabled()) {
      return { success: false, error: 'Webhook not enabled' };
    }

    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      session_id: 'test-session-id',
      token_meta: {
        test: true
      }
    };

    try {
      await this.sendWebhook(testPayload);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async cleanup() {
    while (this.queue.length > 0 && this.processing) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  getQueueStatus() {
    return {
      pending: this.queue.length,
      processing: this.processing
    };
  }
}

module.exports = WebhookManager;