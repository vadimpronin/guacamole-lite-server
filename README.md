# Guacamole Lite Server

A production-ready server application that wraps the `guacamole-lite` library to provide enterprise features through configuration files. This server enables zero-code deployment of Apache Guacamole protocol integration with built-in support for session recording, S3 storage, and webhook notifications.

## Features

- **Configuration-driven**: All functionality controlled via INI files and environment variables
- **Session Recording**: Automatic recording with compression and S3 upload
- **Webhook Notifications**: Real-time event notifications via HTTP
- **Enterprise Ready**: Built-in security, authentication, and monitoring features
- **Docker Support**: Ready for containerized deployment
- **Protocol Support**: RDP, VNC, and SSH connections via guacd

## Quick Start

### Installation

```bash
# Install from npm
npm install -g guacamole-lite-server

# Or clone and install locally
git clone https://github.com/username/guacamole-lite-server.git
cd guacamole-lite-server
npm install
```

### Basic Usage

```bash
# Run with default configuration
guacamole-lite-server

# Run with custom configuration
guacamole-lite-server --config /path/to/config.ini

# Validate configuration
guacamole-lite-server --validate --config /path/to/config.ini
```

### Environment Variables

All configuration options can be overridden with environment variables:

```bash
export SECRET_KEY="your-32-byte-secret-key"
export WEBSOCKET_PORT=8080
export GUACD_HOST=localhost
export S3_ACCESS_KEY_ID="your-access-key"
export S3_SECRET_ACCESS_KEY="your-secret-key"
export WEBHOOK_URL="https://your-webhook-endpoint.com"
```

### Docker Deployment

```bash
# Using Docker Compose (recommended)
docker-compose up -d

# Or build and run manually
docker build -t guacamole-lite-server .
docker run -p 8080:8080 -e SECRET_KEY="your-key" guacamole-lite-server
```

## Configuration

### Minimal Configuration

Create a `config.ini` file:

```ini
secret_key = your-32-byte-secret-key-here
websocket_port = 8080
guacd_host = localhost
```

### Full Configuration Example

See `config/example.ini` for all available options including:

- Protocol-specific defaults (RDP, VNC, SSH)
- S3 storage configuration
- Webhook settings
- Recording options
- Security settings

## Token Format

Connections require encrypted tokens containing connection parameters:

```json
{
  "protocol": "rdp",
  "hostname": "192.168.1.100",
  "port": 3389,
  "username": "user",
  "password": "pass",
  "meta": {
    "userId": "12345",
    "sessionId": "abc-123"
  }
}
```

## Architecture

The server integrates with the Guacamole ecosystem:

```
Client (HTML5) → WebSocket → guacamole-lite-server → guacd → RDP/VNC/SSH
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

## Documentation

- [Configuration Reference](docs/configuration.md)
- [Docker Deployment](docs/docker.md)
- [Webhook Documentation](docs/webhooks.md)

## License

MIT

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/username/guacamole-lite-server/issues)
- Documentation: [Full documentation](https://github.com/username/guacamole-lite-server/wiki)
