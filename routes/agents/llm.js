const { ChatOllama } = require("@langchain/ollama");
const { GigaChat } = require("langchain-gigachat");

const https = require('https');

const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // Отключение проверки сертификатов НУЦ Минцифры
});

const gigaMax = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2-Max',
    maxTokens: 2000,
    httpsAgent: httpsAgent
});

// Инициализация GigaChat клиента
const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 2000,
    httpsAgent: httpsAgent
});
// const giga = new ChatOllama({
//     baseUrl: "http://127.0.0.1:11434",
//     model: 'gemma3:1b',
// })

module.exports = { giga, gigaMax }