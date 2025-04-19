// routes/agents/track-assistant.js
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage, AIMessage } = require("@langchain/core/messages");
const router = require('express').Router();
const { ObjectId } = require('mongodb');
const Track = require('../../models/Track');

const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 400,
});

// Создать ассистента для конкретного трека обучения
router.post('/create/:trackId', async (req, res) => {
    const { trackId } = req.params;
    const { _id } = req.user;
    const token = req.headers.authorization.split(' ')[1];
    
    try {
        // Получаем информацию о треке
        const track = await Track.findById(trackId).populate('lessons');
        
        if (!track) {
            return res.status(404).json({ error: 'Трек не найден' });
        }
        
        if (track.userId.toString() !== _id) {
            return res.status(403).json({ error: 'Нет доступа к этому треку' });
        }
        
        // Создаем системный промпт на основе информации о треке
        const systemPrompt = `
            Ты персональный ассистент для образовательного трека "${track.name}" по предмету "${track.subject}".
            ${track.description ? `Описание трека: ${track.description}` : ''}
            Твоя задача - помогать с вопросами по материалу, объяснять сложные концепции, 
            давать подсказки к заданиям и поддерживать мотивацию к обучению.
            
            Трек включает следующие уроки:
            ${track.lessons.map((lesson, idx) => `${idx+1}. ${lesson.title}`).join('\n')}
        `;
        
        // Сохраняем ассистента в базе
        const assistantData = {
            type: 'track_assistant',
            user_id: _id,
            track_id: trackId,
            track_info: {
                name: track.name,
                subject: track.subject,
                topic: track.topic
            },
            messages: [{
                role: 'system',
                content: systemPrompt
            }],
            created_at: new Date()
        };
        
        const response = await fetch(`http://127.0.0.1:3000/api/trackAssistants/`, {
            method: 'POST',
            body: JSON.stringify(assistantData),
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка при создании ассистента');
        }
        
        const responseData = await response.json();
        return res.json({
            assistant_id: responseData._id,
            message: 'Ассистент трека успешно создан'
        });
        
    } catch (error) {
        console.error('Ошибка при создании ассистента трека:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Задать вопрос ассистенту трека
router.post('/:assistantId/ask', async (req, res) => {
    const { assistantId } = req.params;
    const { message, lessonId } = req.body;
    const { _id } = req.user;
    const token = req.headers.authorization.split(' ')[1];
    
    if (!message) {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }
    
    try {
        // Получаем ассистента
        const assistantResponse = await fetch(`http://127.0.0.1:3000/api/trackAssistants/${assistantId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!assistantResponse.ok) {
            throw new Error('Ошибка при получении ассистента');
        }
        
        const assistant = await assistantResponse.json();
        
        if (assistant.user_id !== _id) {
            return res.status(403).json({ error: 'Нет доступа к этому ассистенту' });
        }
        
        // Если указан lessonId, получим информацию о нем для контекста
        let lessonContext = '';
        if (lessonId) {
            const track = await Track.findById(assistant.track_id).populate({
                path: 'lessons',
                match: { _id: lessonId }
            });
            
            if (track && track.lessons && track.lessons.length > 0) {
                lessonContext = `\nКонтекст: вопрос относится к уроку "${track.lessons[0].title}".`;
            }
        }
        
        // Форматируем сообщения для GigaChat
        const messages = assistant.messages.map(msg => {
            if (msg.role === 'user') {
                return new HumanMessage(msg.content);
            } else if (msg.role === 'assistant') {
                return new AIMessage(msg.content);
            }
            return new SystemMessage(msg.content);
        });
        
        // Добавляем контекст урока к сообщению пользователя
        const userMessage = message + lessonContext;
        
        // Получаем ответ от GigaChat
        const aiMessage = await giga.invoke([
            ...messages,
            new HumanMessage(userMessage)
        ]);
        
        // Обновляем историю сообщений
        assistant.messages.push({
            role: 'user',
            content: message
        });
        
        assistant.messages.push({
            role: 'assistant',
            content: aiMessage.content
        });
        
        // Сохраняем обновленную историю
        const updateResponse = await fetch(`http://127.0.0.1:3000/api/trackAssistants/${assistantId}`, {
            method: 'POST',
            body: JSON.stringify({
                messages: assistant.messages,
                last_interaction: new Date()
            }),
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!updateResponse.ok) {
            throw new Error('Ошибка при обновлении истории сообщений');
        }
        
        return res.json({
            message: aiMessage.content
        });
        
    } catch (error) {
        console.error('Ошибка при взаимодействии с ассистентом:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;
