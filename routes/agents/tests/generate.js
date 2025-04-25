const { PromptTemplate } = require("@langchain/core/prompts");
const { StructuredOutputParser } = require("@langchain/core/output_parsers");
const { RunnableSequence } = require("@langchain/core/runnables");
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
    const promptTemplate = PromptTemplate.fromTemplate(`
Ты - образовательный ассистент, который создает диагностические тесты для учеников.

Твоя задача - сгенерировать {count} вопросов по заданной теме для диагностического теста.
Каждый вопрос должен:
1. Быть с множественным выбором (4 варианта ответа)
2. Иметь один правильный ответ
3. Соответствовать указанной теме ({topic}) и уровню сложности ({difficulty}) для предмета ({subject}).
4. Соответствовать уровню класса ({grade})
5. Содержать четкое объяснение правильного ответа.

Формат ответа должен быть строго в виде JSON, соответствующий инструкциям ниже. НЕ ДОБАВЛЯЙ никакого другого текста, приветствий или markdown разметки (например \`\`\`) вокруг JSON.
Используй escape-символы для символов в LaTeX, например: $\\\\frac$, вместо $\\frac$.

{format_instructions}

Предоставленные данные:
Предмет: {subject}
Тема: {topic}
Уровень сложности: {difficulty}
Уровень класса: {grade}
Создай тест из {count} вопросов.
    
Контекст: {context}
    `);
    
    const parser = StructuredOutputParser.fromZodSchema(z.array(QuestionSchema))
    
    // Create a runnable sequence
    const chain = RunnableSequence.from([
        promptTemplate,
        gigaMax,
        parser
    ]);
    
    try {
        // Execute the chain
        const jsonString = await chain.invoke({
            context: context,
            subject: subject,
            topic: topic,
            difficulty: difficulty,
            count: count,
            grade: grade,
            format_instructions: parser.getFormatInstructions()
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
        const testTitlePrompt = PromptTemplate.fromTemplate(`
        Сгенерируй название теста для предмета {subject} по теме {topic} на уровне сложности {difficulty}.

        Вопросы:
        {questions}

        {format_instructions}
        `);
        
        const testTitleParser = StructuredOutputParser.fromZodSchema(z.object({
            testTitle: z.string()
        }));
        
        const testTitleChain = RunnableSequence.from([
            testTitlePrompt,
            giga,
            testTitleParser
        ]);

        const testTitle = await testTitleChain.invoke({
            subject,
            topic,
            difficulty,
            questions: questions.map(q => ({
                questionText: q.questionText,
            })).join('\n'),
            format_instructions: testTitleParser.getFormatInstructions()
        });

        return testTitle;
}

module.exports = { generateQuestions, generateTestTitle };
