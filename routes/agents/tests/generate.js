const giga = require("../llm");
const {
  ChatPromptTemplate
} = require("@langchain/core/prompts");
// Use Zod structure parser
const { StructuredOutputParser } = require("@langchain/core/output_parsers");
// Assuming schemas.ts is compiled to schemas.js or you are using a bundler/loader
const { TestSchema } = require("./schemas");

/**
 * System prompt template for the initial test generation agent.
 * @constant
 * @type {string}
 */
const TEST_GENERATION_TEMPLATE = `
Ты - образовательный ассистент, который создает диагностические тесты для учеников.

Твоя задача - создать диагностический тест ({num_questions} вопросов) по заданной теме.
Каждый вопрос должен:
1. Быть с множественным выбором (4 варианта ответа)
2. Иметь один правильный ответ
3. Соответствовать указанной теме ({topic}) и уровню сложности ({difficulty}) для предмета ({subject}).
4. Содержать четкое объяснение правильного ответа.

Формат ответа должен быть строго в виде JSON, соответствующий инструкциям ниже. НЕ ДОБАВЛЯЙ никакого другого текста, приветствий или markdown разметки (например \`\`\`) вокруг JSON.

{format_instructions}

Предоставленные данные:
Предмет: {subject}
Тема: {topic}
Уровень сложности: {difficulty}

Создай тест из {num_questions} вопросов.
`;

/**
 * Creates a LangChain prompt template for test generation.
 * @type {ChatPromptTemplate}
 */
const generatePrompt = ChatPromptTemplate.fromMessages([
  ["system", TEST_GENERATION_TEMPLATE],
]);

/**
 * Creates a LangChain output parser using the Zod schema for the Test structure.
 * This ensures the LLM output matches the desired JSON format defined by TestSchema.
 * @type {StructuredOutputParser<typeof TestSchema>}
 */
const generateParser = StructuredOutputParser.fromZodSchema(TestSchema);

/**
 * LangChain runnable sequence (chain) for generating the initial test.
 * It combines the prompt, the LLM (giga), and the Zod-based output parser.
 * The output type is inferred from the TestSchema.
 */
const generateChain = generatePrompt.pipe(giga).pipe(generateParser);

module.exports = {
  generateChain,
  generateParser,
  /**
   * Provides format instructions derived from the Zod schema for the LLM prompt.
   * @type {string}
   */
  generateFormatInstructions: generateParser.getFormatInstructions()
};