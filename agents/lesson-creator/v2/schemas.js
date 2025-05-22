const { z } = require("zod");

const LessonSectionSchema = z.object({
    title: z.string().describe("Название раздела"),
    description: z.string().describe("Краткое описание раздела"),
})

const LessonStructureSchema = z.object({
    sections: z.array(LessonSectionSchema).describe("Разделы урока"),
})

const LessonBaseBlockSchema = z.object({
    blockType: z.enum(["paragraph", "quiz", "plot"]).describe("Тип блока"),
});

const LessonParagraphBlockSchema = LessonBaseBlockSchema.extend({
    blockType: z.literal("paragraph"),
    content: z.string().describe("Содержимое параграфа"),
});

const LessonQuizBlockSchema = LessonBaseBlockSchema.extend({
    blockType: z.literal("quiz"),
    data: z.object({
        question: z.string().describe("Текст вопроса"),
        answers: z.array(z.string()).describe("Варианты ответов"),
        correctAnswer: z.number().describe("Индекс правильного ответа"),
        explanation: z.string().describe("Объяснение ответа"),
    }).describe("Данные для вопроса"),
});

const LessonPlotBlockSchema = LessonBaseBlockSchema.extend({
    blockType: z.literal('plot'),
    data: z.object({
        plotType: z.enum(['line', 'bar', 'scatter', 'pie']).describe("Тип графика"),
        title: z.string().describe("Название графика"),
        xlabel: z.string().describe("Ось X графика"),
        ylabel: z.string().describe("Ось Y графика"),
        // Data can be a generic array of numbers or objects, depending on complexity
        // For simplicity, let's assume an array of objects with x, y for line/scatter
        // Or an array of numbers for bar/pie (with labels)
        series: z.array(z.object({
            name: z.string(),
            points: z.array(z.object({
                x: z.number(),
                y: z.number(),
            })),
        }))
    }).describe("Данные для построения графика")
});

const LessonBlockSchema = z.discriminatedUnion("blockType", [
    LessonParagraphBlockSchema,
    LessonQuizBlockSchema,
    LessonPlotBlockSchema,
]);

const LessonSchema = z.object({
  lesson: z.array(LessonBlockSchema).describe("Блоки урока"),
});

const jsonLessonSchema = {
  "lesson": [
    { "blockType": "paragraph", "content": "string" },
    {
      "blockType": "quiz",
      "data": {
        "question": "string",
        "answers": ["string"],
        "correctAnswer": 0,
        "explanation": "string"
      }
    },
    {
      "blockType": "plot",
      "plotData": {
        "plotType": "line",
        "title": "string",
        "xlabel": "string",
        "ylabel": "string",
        "series": [
          {
            "name": "string",
            "points": [{ "x": 0, "y": 0 }]
          }
        ]
      }
    }
  ]
};

module.exports = {
  LessonSchema,
  LessonStructureSchema,
  jsonLessonSchema
}