const { z } = require('zod'); // Use require instead of import

/**
 * Zod schema for a single multiple-choice question.
 */
const QuestionSchema = z.object({
  questionText: z.string().describe("The text of the question."),
  options: z.array(z.string()).length(4).describe("An array of 4 possible answer strings."),
  correctOptionIndex: z.number().min(0).max(3).describe("The 0-based index of the correct answer in the options array."),
  explanation: z.string().describe("An explanation of why the correct answer is right."),
}).describe("Represents a single multiple-choice question.");

/**
 * Zod schema for the entire diagnostic test structure.
 */
const TestSchema = z.object({
  testTitle: z.string().describe("The title of the generated test."),
  subject: z.string().describe("The subject area of the test."),
  topic: z.string().describe("The specific topic covered by the test."),
  difficulty: z.string().describe("The difficulty level of the test (e.g., basic, intermediate, advanced)."),
  questions: z.array(QuestionSchema).describe("An array of question objects."),
}).describe("Represents a complete diagnostic test.");

// Export the schemas using module.exports for CommonJS compatibility
module.exports = { QuestionSchema, TestSchema }; 