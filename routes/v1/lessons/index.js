const router = require('express').Router();
const { MongoClient, ObjectId } = require("mongodb");

router.get("/", async (req, res) => {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    console.log("[API /lessons] Connected to MongoDB");
    const db = client.db("DatabaseAi");
    const lessons = await db.collection("lessons").find({}).toArray();
    console.log("   Found lessons", lessons);
    res.json(lessons);
  } catch (error) {
    console.error("[API /lessons] Error fetching lessons", error);
    res.status(500).json({ error: "Failed to fetch lessons" });
  } finally {
    await client.close();
    console.log("[API /lessons] Closed MongoDB connection");
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) {
    console.error("[API /lessons/:id] ID is required");
    return res.status(400).json({ error: "ID is required" });
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    console.log("[API /lessons/:id] Connected to MongoDB");
    const db = client.db("DatabaseAi");
    const lesson = await db.collection("lessons").findOne({ _id: new ObjectId(id) });

    if (!lesson) {
      console.error("  Lesson not found");
      return res.status(404).json({ error: "Lesson not found" });
    }

    if (!lesson.content || lesson.content.length === 0) {
      console.warn("  Lesson content is empty");
      return res.status(404).json({ error: "Lesson content is empty" });
    }

    console.log("   Found lesson", lesson);
    res.json(lesson);
  } catch (error) {
    console.error("[API /lessons/:id] Error fetching lesson", error);
    res.status(500).json({ error: "Failed to fetch lesson" });
  } finally {
    await client.close();
    console.log("[API /lessons/:id] Closed MongoDB connection");
  }
});

module.exports = router;