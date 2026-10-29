FROM node:24-alpine
WORKDIR /app
COPY server.mjs ./
USER node
ENV KIUMI_DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server.mjs"]
