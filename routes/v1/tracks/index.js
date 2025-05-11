const router = require('express').Router();
const { MongoClient, ObjectId } = require("mongodb");
const graph = require('../../../agents/lesson-creator/graph');

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
    console.log("[API /tracks] Connected to MongoDB");
    const db = client.db("DatabaseAi");
    const track = await db.collection("tracks").findOne({_id: new ObjectId(trackId), userId});

    if (!track) {
      return res.status(404).json({ error: "Track not found" });
    }
    console.log("   Found track");

    const lessons = await db.collection("lessons").find({ _id: { $in: track.lessons } }).toArray();
    console.log("   Found lessons");
    const { lessonIds, ...rest } = track;
    res.json({
      ...rest,
      lessons: lessons.map((lesson) => ({
        _id: lesson._id.toString(),
        subject: lesson.subject,
        topic: lesson.topic,
        grade: lesson.grade,
        content: lesson.content,
      })),
    });
  } catch (error) {
    console.error("[API /tracks] Error fetching singe track", error);
    res.status(500).json({ error: "Failed to fetch single track" });
  } finally {
    await client.close();
    console.log("[API /tracks] Closed MongoDB connection");
  }
});

module.exports = router;