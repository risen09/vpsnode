const { PromptTemplate } = require("@langchain/core/prompts");
const z = require('zod');
const { getLlm } = require('../../getLlm');

/**
 * Uses LLM to generate a learning plan based on weaknesses.
 * Make it sound fancy for the customer, this learning plan.
 * @param {object} state - The current graph state. Requires `subject`, `topic`, `grade`, `summarizedWeaknesses`.
 * @returns {Promise<object>} Updated state with `learningPlan` object ready for saving.
 */
async function generateLearningPlan(state) {
    console.log("--- Node: generateLearningPlan ---");
    const { subject, topic, grade, summarizedWeaknesses } = state;

    const llm = getLlm({
      model: 'GigaChat-2',
      temperature: 1,
      streaming: false
    }).withStructuredOutput(z.object({
        plan: z.array(z.object({
            priority: z.enum(["Высокий", "Средний", "Низкий"]).describe("Приоритет"),
            subject: z.string().describe("Предмет"),
            topic: z.string().describe("Тема"),
            sub_topic: z.string().describe("Подтема"),
            title: z.string().describe("Название урока")
        })).describe("План обучения")
    }));

    const prompt = PromptTemplate.fromTemplate(`
Ты — опытный преподаватель-методист с экспертизой в педагогическом дизайне. 
Твоя задача — на основе диагностики слабых мест ученика составить персонализированный учебный план, 
который включает как основные темы, так и максимально детализированные подтемы, 
необходимые для углубленного изучения материала. Учебный план должен учитывать когнитивные закономерности 
усвоения материала и анализировать не только ошибки, но и их системные причины. 
Уделяй особое внимание выявлению мелких пробелов в знаниях и включению их в список подтем для детальной проработки, 
каждый раз перепроверяй действительно ли учел все необходимые темы и подтемы.

Данные:
- Предмет: {subject}
- Тема: {topic}
- Класс: {grade}
- Слабые места: {summarizedWeaknesses}

Задача: Составь четкий и детализированный пошаговый план улучшения, чтобы он включал как основные темы, 
так и расширенный список подтем, необходимых для полного освоения темы, 
каждый раз перепроверяй действительно ли учел все необходимые темы для усвоения материала, тем, подтем.
    `);

    const chain = prompt.pipe(llm);

    const { plan: learningPlan } = await chain.invoke({
      subject: subject,
      topic: topic,
      grade: grade,
      summarizedWeaknesses: summarizedWeaknesses,
    });

    console.log("[Graph] Draft learning plan created:", learningPlan);
    return { learningPlan };
}

module.exports = { generateLearningPlan };