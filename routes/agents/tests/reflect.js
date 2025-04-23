const giga = require("../llm");
const {
  ChatPromptTemplate
} = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
// Import type if needed, assuming JS environment for now
// import type { Test } from './schemas';

/**
 * System prompt template for the critique agent.
 * It evaluates the quality of a generated test based on several criteria.
 * @constant
 * @type {string}
 */
const CRITIQUE_TEMPLATE = `
Ты - опытный методист и редактор учебных материалов по предмету: {subject}.
Твоя задача - внимательно проверить и оценить качество предложенного теста по теме "{topic}" с уровнем сложности "{difficulty}".

Предоставленный тест (в формате JSON):
\`\`\`json
{test_json}
\`\`\`

Проверь тест по следующим критериям:
1.  **Актуальность и соответствие теме/сложности:** Насколько вопросы соответствуют заявленной теме ({topic}), предмету ({subject}) и уровню сложности ({difficulty})? Нет ли слишком простых или слишком сложных вопросов?
2.  **Четкость формулировок:** Понятны ли тексты вопросов? Нет ли двусмысленности?
3.  **Качество вариантов ответа:** Являются ли неправильные варианты (дистракторы) правдоподобными, но однозначно неверными? Нет ли среди них второго правильного ответа? Правильный ли ответ (указанный как correctOptionIndex в JSON) действительно единственно верный?
4.  **Качество объяснений:** Являются ли объяснения правильных ответов точными, понятными и достаточными?
5.  **Общее качество:** Есть ли какие-либо другие замечания по улучшению теста (например, грамматика, стиль, логика)?

Предоставь свою критику в виде четкого текста. Если тест хорош, напиши "Тест не требует доработки.". Если есть замечания, перечисли их по пунктам, указывая номер вопроса (начиная с 1), если замечание относится к конкретному вопросу. Будь конструктивен.

Пример ответа с замечаниями:
Тест требует доработки:
- Вопрос 2: Формулировка неясна, перефразировать. Неправильный вариант C слишком близок к правильному.
- Вопрос 4: Объяснение недостаточно подробное.
- Общее: Некоторые вопросы кажутся сложнее заявленного уровня "intermediate".

Пример ответа без замечаний:
Тест не требует доработки.
`;

/**
 * Creates a LangChain prompt template for test critique.
 * Expects 'subject', 'topic', 'difficulty', and 'test_json' as input variables.
 * @type {ChatPromptTemplate}
 */
const critiquePrompt = ChatPromptTemplate.fromMessages([
  ["system", CRITIQUE_TEMPLATE],
]);

/**
 * Basic output parser that returns the LLM response as a string.
 * @type {StringOutputParser}
 */
const critiqueParser = new StringOutputParser();

/**
 * LangChain runnable sequence (chain) for critiquing a generated test.
 * It combines the prompt, the LLM (giga), and a string output parser.
 * @type {RunnableSequence<Record<string, any>, string>}
 */
const critiqueChain = critiquePrompt.pipe(giga).pipe(critiqueParser);

module.exports = { critiqueChain };