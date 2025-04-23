const giga = require("../llm");
const {
  ChatPromptTemplate
} = require("@langchain/core/prompts");
const { StructuredOutputParser } = require("@langchain/core/output_parsers");
// Import the Zod schema and reuse parser/instructions from generate.js
const { TestSchema } = require("./schemas");
const { generateFormatInstructions, generateParser } = require("./generate");

/**
 * System prompt template for the refinement agent.
 * Takes initial request parameters and critique feedback to improve a test.
 * @constant
 * @type {string}
 */
const REFINE_TEMPLATE = `
Ты - образовательный ассистент, который создает и УЛУЧШАЕТ диагностические тесты.
Твоя задача - пересмотреть и улучшить тест ({num_questions} вопросов) по предмету ({subject}), теме ({topic}) и уровню сложности ({difficulty}), основываясь на предоставленной критике.

ИСХОДНЫЕ ТРЕБОВАНИЯ:
Предмет: {subject}
Тема: {topic}
Уровень сложности: {difficulty}
Количество вопросов: {num_questions}

КРИТИКА ПРЕДЫДУЩЕЙ ВЕРСИИ ТЕСТА:
{critique}

Твоя цель - создать НОВУЮ, УЛУЧШЕННУЮ ВЕРСИЮ теста, которая УЧИТЫВАЕТ все пункты критики.
Новая версия должна соответствовать всем исходным требованиям (предмет, тема, сложность, количество вопросов) и критериям качества (четкость, правильность, хорошие дистракторы, понятные объяснения).

Формат ответа должен быть строго в виде JSON, соответствующий инструкциям ниже. НЕ ДОБАВЛЯЙ никакого другого текста, приветствий или markdown разметки (например \`\`\`) вокруг JSON.

{format_instructions}

Сгенерируй улучшенную версию теста.
`;

/**
 * Creates a LangChain prompt template for test refinement.
 * Expects 'subject', 'topic', 'difficulty', 'num_questions', 'critique', and 'format_instructions'.
 * @type {ChatPromptTemplate}
 */
const refinePrompt = ChatPromptTemplate.fromMessages([
  ["system", REFINE_TEMPLATE],
]);

/**
 * LangChain runnable sequence (chain) for refining an existing test based on critique.
 * It combines the refinement prompt, the LLM (giga), and the same Zod-based output parser used for generation.
 * The output type is inferred from the TestSchema via generateParser.
 */
const refineChain = refinePrompt.pipe(giga).pipe(generateParser); // Re-use the same parser

module.exports = { refineChain }; 