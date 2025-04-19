// routes/agents/progress-analyzer.js
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const router = require('express').Router();
const Track = require('../../models/Track');

const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 600,
});

// Анализ прогресса ученика в треке
router.post('/analyze/:trackId', async (req, res) => {
    const { trackId } = req.params;
    const { _id } = req.user;
    
    try {
        // Получение данных трека и прогресса
        const track = await Track.findById(trackId)
            .populate('lessons')
            .populate('tests');
            
        if (!track) {
            return res.status(404).json({ error: 'Трек не найден' });
        }
        
        if (track.userId.toString() !== _id) {
            return res.status(403).json({ error: 'Нет доступа к этому треку' });
        }
        
        // Сбор данных о прогрессе (можно адаптировать под вашу структуру данных)
        // Это примерная реализация
        let completedLessons = 0;
        let totalLessonsTime = 0;
        
        for (const lesson of track.lessons) {
            if (lesson.completed) {
                completedLessons++;
                totalLessonsTime += lesson.timeSpent || 0;
            }
        }
        
        let testScores = [];
        for (const test of track.tests) {
            if (test.completed) {
                testScores.push(test.score);
            }
        }
        
        const avgTestScore = testScores.length > 0 
            ? testScores.reduce((sum, score) => sum + score, 0) / testScores.length 
            : 0;
        
        // Подготовка данных для анализа
        const progressData = {
            trackName: track.name,
            subject: track.subject,
            totalLessons: track.lessons.length,
            completedLessons,
            progressPercentage: (completedLessons / track.lessons.length) * 100,
            averageTestScore: avgTestScore,
            totalLessonsTime,
            startDate: track.createdAt,
            currentDate: new Date()
        };
        
        // Генерация анализа с помощью GigaChat
        const systemPrompt = new SystemMessage(`
            Ты аналитик образовательных данных. Твоя задача - проанализировать прогресс ученика 
            и предоставить полезную обратную связь, выявить сильные и слабые стороны, 
            дать рекомендации по улучшению обучения.
        `);
        
        const userPrompt = `
            Проанализируй следующие данные о прогрессе в образовательном треке:
            
            Трек: ${progressData.trackName}
            Предмет: ${progressData.subject}
            Пройдено уроков: ${progressData.completedLessons} из ${progressData.totalLessons}
            Прогресс: ${progressData.progressPercentage.toFixed(1)}%
            Средний балл по тестам: ${progressData.averageTestScore.toFixed(1)}%
            Общее время на уроки: ${Math.floor(progressData.totalLessonsTime / 60)} часов ${progressData.totalLessonsTime % 60} минут
            Начало обучения: ${progressData.startDate.toLocaleDateString()}
            
            Пожалуйста, предоставь:
            1. Анализ текущего прогресса
            2. Выявление сильных и слабых сторон
            3. Рекомендации по улучшению обучения
            4. Прогноз завершения трека при текущем темпе
        `;
        
        const aiResponse = await giga.invoke([
            systemPrompt,
            new HumanMessage(userPrompt)
        ]);
        
        return res.json({
            progressStats: progressData,
            analysis: aiResponse.content
        });
        
    } catch (error) {
        console.error('Ошибка при анализе прогресса:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;
