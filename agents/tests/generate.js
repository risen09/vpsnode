const { PromptTemplate } = require("@langchain/core/prompts");
const { QuestionSchema } = require("./schemas");
const { z } = require("zod");
const { giga } = require("../llm");

/**
 * Generates additional questions using the LLM when not enough questions are found in the vector store.
 * @param {string} subject - The subject area
 * @param {string} topic - The specific topic
 * @param {string} difficulty - The difficulty level
 * @param {number} count - Number of questions to generate
 * @returns {Promise<Array>} - Array of generated questions
 */
async function generateQuestions(context, subject, topic, difficulty, count, grade) {
    console.log(`[LLM] Generating ${count} questions for ${subject}/${topic} (${difficulty})`);
    
    // Create a prompt template for generating test questions
    const prompt = PromptTemplate.fromTemplate(`
Ты - образовательный ассистент, который создает диагностические тесты для учеников.

Твоя задача - сгенерировать {count} вопросов по заданной теме для диагностического теста.
Каждый вопрос должен:
1. Иметь один правильный ответ
2. Соответствовать указанной теме ({topic}) и уровню сложности ({difficulty}) для предмета ({subject}).
3. Соответствовать уровню класса ({grade})
4. Содержать четкое объяснение правильного ответа.

Используй escape-символы для символов в LaTeX, например: $\\\\frac{{a}}{{b}}$, вместо $\\frac{{a}}{{b}}$.

Контекст: {context}
    `);
    

    const structuredModel = giga.withStructuredOutput(z.array(QuestionSchema));

    const chain = prompt.pipe(structuredModel);
    
    try {
        // Execute the chain
        const jsonString = await chain.invoke({
            context: context,
            subject: subject,
            topic: topic,
            difficulty: difficulty,
            count: count,
            grade: grade,
        });

        // Validate the entire array with Zod
        const validatedArray = z.array(QuestionSchema).parse(jsonString);
        console.log(`[LLM] Successfully generated and validated ${validatedArray.length} questions`);
        return validatedArray;
    } catch (error) {
        console.error("[LLM] Error during question generation:", error);
        return []; // Return empty array on any error
    }
}


async function generateTestTitle(subject, topic, difficulty, questions) {
        const prompt = PromptTemplate.fromTemplate(`
        Сгенерируй название теста для предмета {subject} по теме {topic} на уровне сложности {difficulty}.

        Вопросы:
        {questions}
        `);
        
        const structuredModel = giga.withStructuredOutput(z.object({
            testTitle: z.string().describe("Название теста"),
        }));
        
        const chain = prompt.pipe(structuredModel);
        
        const testTitle = await chain.invoke({
            subject,
            topic,
            difficulty,
            questions: JSON.stringify(questions.map(q => ({
                questionText: q.questionText
            })))
        });

        return testTitle;
}

module.exports = { generateQuestions, generateTestTitle };
