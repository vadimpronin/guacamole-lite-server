FROM node:18-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY package*.json ./

RUN npm ci --production

COPY . .

RUN mkdir -p /data/recordings /data/drives

VOLUME ["/data/recordings", "/data/drives"]

EXPOSE 8080

ENTRYPOINT ["tini", "--"]

CMD ["node", "bin/guacamole-lite-server"]