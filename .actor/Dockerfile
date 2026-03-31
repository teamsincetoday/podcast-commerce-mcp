FROM apify/actor-node:20

WORKDIR /usr/src/app

COPY apify/package*.json ./
RUN npm install --production

COPY apify/ ./

CMD ["node", "main.js"]
