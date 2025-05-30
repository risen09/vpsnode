const { z } = require('zod'); // Use require instead of import

const RequestSchema = z.object({
    subject: z.string().min(1),
    topic: z.string().min(1),
    sub_topic: z.string().optional(),
    difficulty: z.string().min(1),
    grade: z.number().min(1).max(11),
    numQuestions: z.number().int().positive().default(5)
});

module.exports = { RequestSchema };