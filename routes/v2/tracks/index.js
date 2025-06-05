const router = require('express').Router();
const { MongoClient, ObjectId } = require("mongodb");
const { lessonCreatorAgent } = require('../../../agents/lesson-creator/graph');
const Lesson = require('../../../models/Lesson');

router.get("/", async (req, res) => {
  const client = new MongoClient(process.env.MONGODB_URI);
  const { _id: userId } = req.user;
  try {
    await client.connect();
    console.log("[API /tracks] Connected to MongoDB");
    const db = client.db("DatabaseAi");
    const tracks = await db.collection("tracks").find({userId}).toArray();
    console.log("   Found tracks", tracks);
    res.json(tracks);
  } catch (error) {
    console.error("[API /tracks] Error fetching tracks", error);
    res.status(500).json({ error: "Failed to fetch tracks" });
  } finally {
    await client.close();
    console.log("[API /tracks] Closed MongoDB connection");
  }
});

router.get("/:trackId", async (req, res) => {
  const client = new MongoClient(process.env.MONGODB_URI);
  const { trackId } = req.params;
  const { _id: userId } = req.user;

  try {
    await client.connect();
    const db = client.db("DatabaseAi");
    
    // Находим трек
    const track = await db.collection("tracks").findOne({
      _id: new ObjectId(trackId),
      userId: userId
    });

    if (!track) {
      return res.status(404).json({ error: "Track not found" });
    }

    // Получаем ID уроков
    const lessonObjectIds = track.lessons.map(l => new ObjectId(l.lesson));
    
    // Находим уроки
    const lessons = await db.collection("lessons")
      .find({ _id: { $in: lessonObjectIds } })
      .toArray();

    // Создаем маппинг уроков
    const lessonsMap = new Map();
    lessons.forEach(lesson => {
      lessonsMap.set(lesson._id.toString(), {
        _id: lesson._id.toString(),
        title: lesson.title,
        subject: lesson.subject,
        topic: lesson.topic,
        sub_topic: lesson.sub_topic,
        content: lesson.content,
        difficulty: lesson.difficulty,
      });
    });

    // Формируем ответ
    const response = {
      ...track,
      _id: track._id.toString(),
      createdAt: track.createdAt.toISOString(),
      lessons: track.lessons.map(trackLesson => ({
        lesson: lessonsMap.get(trackLesson.lesson.toString()),
        priority: trackLesson.priority
      })),
      
    };

    res.json(response);
    
  } catch (error) {
    console.error("Error fetching track:", error);
    res.status(500).json({ error: "Failed to fetch track" });
  } finally {
    await client.close();
  }
});

router.post("/:trackId/requestLesson", async (req, res) => {
  const client = new MongoClient(process.env.MONGODB_URI);
  const { topic, priority = "Средний" } = req.body; // Добавляем приоритет по умолчанию
  const { trackId } = req.params;
  const userId = req.user._id; // Исправляем получение userId
  const token = req.headers.authorization?.split(' ')[1];
  let threadId = null;

  try {
    await client.connect();
    console.log(`[API /tracks/:trackId/requestLesson] Connected to MongoDB`);
    const db = client.db("DatabaseAi");

    // Находим трек с проверкой владельца
    const track = await db.collection("tracks").findOne({
      _id: new ObjectId(trackId),
      userId: userId // Проверяем, что трек принадлежит пользователю
    });
    
    if (!track) {
      return res.status(404).json({ error: "Track not found or access denied" });
    }
    
    console.log("Found track:", JSON.stringify(track, null, 2));

    // Генерируем ID для треда
    threadId = crypto.randomUUID();
    console.log(`Thread ID: ${threadId}`);

    // Параметры для создания урока
    const params = {
      subject: track.subject,
      topic,
      grade: track.grade,
    };

    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    console.log(`Invoking agent with params: ${JSON.stringify(params)} and config: ${JSON.stringify(config)}`);
    
    // Создаем урок через агента
    const { lessonId } = await lessonCreatorAgent.invoke(params, config);
    console.log(`Successfully created lesson with ID: ${lessonId}`);

    // Добавляем новый урок в трек с указанным приоритетом
    const updatedLessons = [
      ...track.lessons,
      {
        lesson: new ObjectId(lessonId), // Сохраняем как ObjectId
        priority: priority // Используем приоритет из запроса или по умолчанию
      }
    ];

    // Обновляем трек в базе
    const updateResult = await db.collection("tracks").updateOne(
      { _id: new ObjectId(trackId), userId },
      { $set: { lessons: updatedLessons } }
    );

    if (updateResult.modifiedCount === 0) {
      throw new Error("Failed to update track");
    }

    console.log("Successfully updated track in MongoDB");
    
    // Возвращаем полную информацию о созданном уроке
    const createdLesson = await db.collection("lessons").findOne({
      _id: new ObjectId(lessonId)
    });

    if (!createdLesson) {
      throw new Error("Created lesson not found");
    }

    res.status(200).json({
      lesson: {
        _id: createdLesson._id.toString(),
        title: createdLesson.title,
        subject: createdLesson.subject,
        topic: createdLesson.topic,
        sub_topic: createdLesson.sub_topic,
        priority: priority
      },
      threadId
    });

  } catch (error) {
    console.error("[API] Error creating lesson:", error);
    res.status(500).json({ 
      error: "Failed to create lesson",
      details: error.message 
    });
  } finally {
    await client.close();
    console.log("[API] Closed MongoDB connection");
  }
});

module.exports = router;