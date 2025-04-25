const { z } = require('zod'); // Use require instead of import

/**
 * Extended Zod schema for question metadata in the vector store
 */
const QuestionMetadataSchema = z.object({
    subject: z.string(),
    topic: z.string(),
    sub_topic: z.string().optional(),
    difficulty: z.string(),
    questionText: z.string(),
    options: z.array(z.string()).length(4),
    correctOptionIndex: z.number().min(0).max(3),
    explanation: z.string(),
    question_id: z.string().or(z.number().transform(n => n.toString())),
}).passthrough(); // Allow additional fields

/**
 * Schema for a document to be stored in the vector store
 */
const VectorStoreDocumentSchema = z.object({
    pageContent: z.string(),
    metadata: QuestionMetadataSchema,
});

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

const RequestSchema = z.object({
    subject: z.string().min(1),
    topic: z.string().min(1),
    difficulty: z.string().min(1),
    numQuestions: z.number().int().positive().default(5)
});
module.exports = { QuestionSchema, TestSchema, QuestionMetadataSchema, VectorStoreDocumentSchema, RequestSchema }; 