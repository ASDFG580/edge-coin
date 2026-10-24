FROM node:20-alpine

WORKDIR /app

COPY server.js index.html styles.css game.js package.json ./
COPY preview*.png ./

ENV NODE_ENV=production
ENV PORT=8130

EXPOSE 8130

CMD ["node", "server.js"]
