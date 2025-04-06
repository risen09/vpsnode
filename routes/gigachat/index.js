const https = require('https');
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const router = require('express').Router();
const { ObjectId } = require('mongodb');

module.exports = router

const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // Отключение проверки сертификатов НУЦ Минцифры
});

const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 200,
    httpsAgent
})

const messages = [
    new SystemMessage("Ты помощник-репетитор для школьников 5-11 классов. Ты отлично знаешь математику, физику,программирование. Ты умеешь объяснять задачи и помогать решать их. Ты всегда готов помочь. Ты готов помочь школьникам и студентам решать задачи и понимать теорию. "),
    // new HumanMessage("Привет! Объясни мне как решать квадратные уравнения. Я istj, я учусь в 7 классе."),
];

router.post('/chat/:id', async (req, res) => {
    const { id } = req.params;
    const message = req.body.message;
    const { cognitive_profile, selected_subjects } = req.user;

    const personalizedMessage = `
        Помоги мне пожалуйста со следующим запросом:
        ${message}
        
        Учитывая мой (Cognitive Profile) и выбранные предметы (Selected Subjects), ответь на вопрос.

        Cognitive Profile: ${JSON.stringify(cognitive_profile)}
        Selected Subjects: ${selected_subjects.join(', ')}
    `;

    console.log(personalizedMessage);

    messages.push(new HumanMessage(message));

    try {
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Неверный формат ID' });
        }

        const token = req.headers.authorization.split(' ')[1];
        const response = await fetch(`http://localhost:3000/api/chatHistory/${id}`, {
            method: 'POST',
            body: JSON.stringify({messages}),
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ошибка при сохранении истории чата:', errorText);
            return res.status(response.status).json({ error: 'Ошибка при сохранении истории чата' });
        }
        
        const responseData = await response.json();
        console.log('История чата сохранена:', responseData);
        
        const gigaResponse = await giga.invoke(messages);
        console.log(gigaResponse.content);
        return res.send({message: gigaResponse.content});
    } catch (error) {
        console.error('Ошибка:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});