const WebhookManager = require('../lib/webhook-manager');
const axios = require('axios');

jest.mock('axios', () => jest.fn());

describe('WebhookManager', () => {
  let webhookManager;
  let config;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    config = {
      webhook_enable: true,
      webhook_url: 'https://example.com/webhook'
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    test('should be enabled with valid config', () => {
      webhookManager = new WebhookManager(config);
      expect(webhookManager.isEnabled()).toBe(true);
    });

    test('should be disabled without webhook_url', () => {
      config.webhook_url = null;
      webhookManager = new WebhookManager(config);
      expect(webhookManager.isEnabled()).toBe(false);
    });

    test('should be disabled when webhook_enable is false', () => {
      config.webhook_enable = false;
      webhookManager = new WebhookManager(config);
      expect(webhookManager.isEnabled()).toBe(false);
    });
  });

  describe('sendSessionStarted()', () => {
    beforeEach(() => {
      webhookManager = new WebhookManager(config);
      axios.mockResolvedValue({ status: 200, data: {} });
    });

    test('should queue session started webhook', async () => {
      const connection = {
        token: { meta: { userId: '123', sessionId: 'abc' } }
      };
      
      await webhookManager.sendSessionStarted('session-123', connection);
      jest.runOnlyPendingTimers();
      
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'POST',
        url: 'https://example.com/webhook',
        data: expect.objectContaining({
          event: 'session_started',
          session_id: 'session-123',
          token_meta: { userId: '123', sessionId: 'abc' }
        })
      }));
    });

    test('should not send webhook when disabled', async () => {
      config.webhook_enable = false;
      webhookManager = new WebhookManager(config);
      
      await webhookManager.sendSessionStarted('session-123', {});
      jest.runOnlyPendingTimers();
      
      expect(axios).not.toHaveBeenCalled();
    });
  });

  describe('sendSessionEnded()', () => {
    beforeEach(() => {
      webhookManager = new WebhookManager(config);
      axios.mockResolvedValue({ status: 200, data: {} });
    });

    test('should queue session ended webhook', async () => {
      const connection = {
        token: { meta: { userId: '123' } }
      };
      
      await webhookManager.sendSessionEnded('session-123', connection);
      jest.runOnlyPendingTimers();
      
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          event: 'session_ended',
          session_id: 'session-123'
        })
      }));
    });
  });

  describe('sendRecordingSaved()', () => {
    beforeEach(() => {
      webhookManager = new WebhookManager(config);
      axios.mockResolvedValue({ status: 200, data: {} });
    });

    test('should queue recording saved webhook', async () => {
      const connection = {
        token: { meta: { userId: '123' } }
      };
      
      await webhookManager.sendRecordingSaved('session-123', connection, 'my-bucket', 'recordings/test.guac');
      jest.runOnlyPendingTimers();
      
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          event: 'recording_saved',
          session_id: 'session-123',
          recording: {
            bucket: 'my-bucket',
            key: 'recordings/test.guac'
          }
        })
      }));
    });
  });

  describe('webhook retry logic', () => {
    beforeEach(() => {
      webhookManager = new WebhookManager(config);
    });

    test('should retry failed webhooks', async () => {
      axios.mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce({ status: 200, data: {} });
      
      await webhookManager.sendSessionStarted('session-123', {});
      
      // First attempt fails
      jest.runOnlyPendingTimers();
      expect(axios).toHaveBeenCalledTimes(1);
      
      // Wait for retry delay and second attempt succeeds
      jest.advanceTimersByTime(2000);
      jest.runOnlyPendingTimers();
      expect(axios).toHaveBeenCalledTimes(2);
    });

    test('should stop retrying after max attempts', async () => {
      axios.mockRejectedValue(new Error('Always fails'));
      
      await webhookManager.sendSessionStarted('session-123', {});
      
      // Process all retries
      for (let i = 0; i < 5; i++) {
        jest.runOnlyPendingTimers();
        jest.advanceTimersByTime(30000);
      }
      
      expect(axios).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    test('should handle HTTP error responses', async () => {
      axios.mockResolvedValue({ status: 500, statusText: 'Internal Server Error' });
      
      await webhookManager.sendSessionStarted('session-123', {});
      jest.runOnlyPendingTimers();
      
      // Should retry on HTTP errors
      expect(webhookManager.queue.length).toBeGreaterThan(0);
    });
  });

  describe('authentication', () => {
    test('should add Bearer token when configured', async () => {
      config.webhook_auth_type = 'bearer';
      config.webhook_auth_token = 'my-token';
      webhookManager = new WebhookManager(config);
      axios.mockResolvedValue({ status: 200, data: {} });
      
      await webhookManager.sendSessionStarted('session-123', {});
      jest.runOnlyPendingTimers();
      
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token'
        })
      }));
    });

    test('should add Basic auth when configured', async () => {
      config.webhook_auth_type = 'basic';
      config.webhook_auth_username = 'user';
      config.webhook_auth_password = 'pass';
      webhookManager = new WebhookManager(config);
      axios.mockResolvedValue({ status: 200, data: {} });
      
      await webhookManager.sendSessionStarted('session-123', {});
      jest.runOnlyPendingTimers();
      
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        auth: {
          username: 'user',
          password: 'pass'
        }
      }));
    });
  });

  describe('testWebhook()', () => {
    beforeEach(() => {
      webhookManager = new WebhookManager(config);
    });

    test('should send test webhook', async () => {
      axios.mockResolvedValue({ status: 200, data: {} });
      
      const result = await webhookManager.testWebhook();
      
      expect(result).toEqual({ success: true });
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          event: 'test',
          session_id: 'test-session-id'
        })
      }));
    });

    test('should handle test webhook failure', async () => {
      axios.mockRejectedValue(new Error('Connection refused'));
      
      const result = await webhookManager.testWebhook();
      
      expect(result).toEqual({ success: false, error: 'Connection refused' });
    });

    test('should return error when disabled', async () => {
      config.webhook_enable = false;
      webhookManager = new WebhookManager(config);
      
      const result = await webhookManager.testWebhook();
      
      expect(result).toEqual({ success: false, error: 'Webhook not enabled' });
    });
  });

  describe('cleanup()', () => {
    test('should wait for pending webhooks', async () => {
      webhookManager = new WebhookManager(config);
      axios.mockResolvedValue({ status: 200, data: {} });
      
      await webhookManager.sendSessionStarted('session-123', {});
      
      const cleanupPromise = webhookManager.cleanup();
      jest.runOnlyPendingTimers();
      
      await cleanupPromise;
      
      expect(webhookManager.queue.length).toBe(0);
    });
  });

  describe('getQueueStatus()', () => {
    test('should return queue status', () => {
      webhookManager = new WebhookManager(config);
      
      const status = webhookManager.getQueueStatus();
      
      expect(status).toEqual({
        pending: 0,
        processing: false
      });
    });
  });
});