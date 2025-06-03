const { PromptTemplate } = require("@langchain/core/prompts");
const { getLlm } = require("../../getLlm");

/**
 * Uses LLM to generate a learning plan based on weaknesses.
 * Make it sound fancy for the customer, this learning plan.
 * @param {object} state - The current graph state. Requires `userId`, `subject`, `topic`, `foundLessonIds`, `summarizedWeaknesses`, `topicsNeedingLessons`.
 * @returns {Promise<object>} Updated state with `learningPlan` object ready for saving.
 */
async function generateLearningPlan(state) {
    console.log("--- Node: generateLearningPlan ---");
    const { userId, subject, topic, grade, summarizedWeaknesses } = state;

    const llm = getLlm();

    const prompt = PromptTemplate.fromTemplate(`
Ты — опытный преподаватель-методист с экспертизой в педагогическом дизайне. На основе диагностики слабых мест ученика составь персонализированный учебный план, 
учитывающий когнитивные закономерности усвоения материала. Анализируй не только ошибки, но и их системные причины.

Данные:
- Предмет: {subject}
- Тема: {topic}
- Слабые места: {summarizedWeaknesses}

Учитывай предварительные требования (prerequisites) для каждой темы. Комбинируй форматы материалов (видео/текст/интерактив). 
Предусмотри 3 уровня заданий: базовые → практические → творческие. 
Укажи критерии успешного прохождения этапа.

Задача: Составь четкий пошаговый план улучшения

Формат ответа (JSON):
{
    "plan": [
        {
            "priority": "Приоритет"
            "subject": "Предмет",
            "topic": "Тема",
            "sub_topic": "Подтема",
            "materials": [
              {
                "type": тип материала (текст, видео, интерактив),
                "format": "симуляция преобразований",
                "duration_min": 20
              }
            ],
            "level": "Уровень задания (базовый, когнитивный, творческий)"
            "success_criteria": "Процент правильно выполненных задач",

        }, ...
    ]
}
    `);

    const chain = prompt.pipe(llm);

    const { plan } = await chain.invoke({
      subject: subject,
      topic: topic,
      summarizedWeaknesses: summarizedWeaknesses,
    });

    const learningPlan = {
        plan: plan
    };

    console.log("[Graph] Draft learning plan created:", learningPlan);
    return { learningPlan };
}

module.exports = { generateLearningPlan };