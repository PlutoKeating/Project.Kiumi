FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs wechat.mjs ./
USER node
ENV KIUMI_DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server.mjs"]
