const { z } = require('zod'); // Use require instead of import

/**
 * Extended Zod schema for question metadata in the vector store
 */
const QuestionMetadataSchema = z.object({
    subject: z.string(),
    topic: z.string(),
    sub_topic: z.string().optional(),
    grade: z.number().min(1).max(11),
    difficulty: z.string(),
    questionText: z.string(),
    options: z.string(),
    correctOptionIndex: z.string(),
    explanation: z.string(),
    question_id: z.string().or(z.number().transform(n => n.toString())),
}).passthrough(); // Allow additional fields

/**
 * Zod schema for a single multiple-choice question.
 */
const QuestionSchema = z.object({
  topic: z.string().describe("The topic of the question."),
  sub_topic: z.string().describe("The sub-topic of the question."),
  grade: z.number().min(1).max(11).describe("The grade level of the question."),
  questionText: z.string().describe("The text of the question."),
  options: z.array(z.string()).length(4).describe("An array of 4 possible answer strings."),
  correctOptionIndex: z.number().min(0).max(3).describe("The 0-based index of the correct answer in the options array."),
  explanation: z.string().describe("An explanation of why the correct answer is right."),
}).describe("Represents a single multiple-choice question.");

/**
 * Zod schema for the entire diagnostic test structure.
 */
const TestSchema = z.object({
  user_id: z.string().describe("The user ID of the test."),
  testTitle: z.string().describe("The title of the generated test."),
  subject: z.string().describe("The subject area of the test."),
  topic: z.string().describe("The specific topic covered by the test."),
  grade: z.number().min(1).max(11).describe("The grade level of the test."),
  difficulty: z.string().describe("The difficulty level of the test (e.g., basic, intermediate, advanced)."),
  questions: z.array(QuestionSchema).describe("An array of question objects."),
  userAnswers: z.array(z.string()).describe("An array of user answers."),
  completed: z.boolean().describe("Whether the test has been completed."),
  score: z.number().nullable().describe("The score of the test."),
  createdAt: z.date().describe("The date and time the test was created."),
}).describe("Represents a complete diagnostic test.");

const RequestSchema = z.object({
    subject: z.string().min(1),
    topic: z.string().min(1),
    difficulty: z.string().min(1),
    grade: z.number().min(1).max(11),
    numQuestions: z.number().int().positive().default(5)
});
module.exports = { QuestionSchema, TestSchema, QuestionMetadataSchema, RequestSchema }; 