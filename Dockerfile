FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY package-lock.json ./�
RUN npm install --production
COPY . .ложение

EXPOSE 3000
CMD ["npm", "start"]
