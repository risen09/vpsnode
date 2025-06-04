const { z } = require("zod");

const ReviewSchema = z.object({
    "verdict": z.enum(["correct", "incorrect", "partially_correct"]).describe("Результат проверки"),
    "explanation": z.string().describe("Краткое объяснение, почему ответ верный, неверный или частично верный"),
    "suggestion": z.string().describe("Подсказка или указание на улучшение/исправление, если требуется"),
});

module.exports = {
    ReviewSchema,
}