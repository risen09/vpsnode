const https = require('https');
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const router = require('express').Router();

module.exports = router

const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // Отключение проверки сертификатов НУЦ Минцифры
});

const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    httpsAgent
})

const messages = [
    new SystemMessage("Ты помощник-репетитор для школьников 5-11 классов. Ты отлично знаешь математику, физику,программирование. Ты умеешь объяснять задачи и помогать решать их. Ты всегда готов помочь. Ты готов помочь школьникам и студентам решать задачи и понимать теорию. Ты всегда готов помочь."),
    // new HumanMessage("Привет! Объясни мне как решать квадратные уравнения. Я istj, я учусь в 7 классе."),
];

router.post('/chat', async (req, res) => {
    const message = req.body.message
    messages.push(new HumanMessage(message));
    const response = await giga.invoke(messages);
    console.log(response.content);
    return res.send({message: response.content})
});