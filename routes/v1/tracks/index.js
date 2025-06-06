const router = require('express').Router();
const { MongoClient, ObjectId } = require("mongodb");
const { lessonCreatorAgent } = require('../../../agents/lesson-creator/graph');
const {Track} = require('../../../models/Track');
const {Lesson} = require('../../../models/Lesson');

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
  const { trackId } = req.params;
  const { _id: userId } = req.user;
  
  try {
    console.log("[API /tracks] Fetching track with lessons");
    
    const track = await Track.findOne({ _id: trackId, userId }).lean();
    
    if (!track) {
      return res.status(404).json({ error: "Track not found" });
    }
    console.log("[API /tracks] Found track");

    console.log("[API /tracks] Track lessons", track.lessons);
    
    const lessons = await Lesson.find({ 
      _id: { $in: track.lessons } 
    }).select('_id subject topic grade content').lean();
    
    console.log("[API /tracks] Found lessons " + lessons.length);
    
    const { lessonIds, ...rest } = track;
    res.json({
      ...rest,
      lessons: lessons.map(lesson => ({
        ...lesson,
        _id: lesson._id.toString()
      }))
    });
    
  } catch (error) {
    console.error("[API /tracks] Error fetching single track", error);
    res.status(500).json({ error: "Failed to fetch single track" });
  }
});

router.post("/:trackId/requestLesson", async (req, res) => {
  const client = new MongoClient(process.env.MONGODB_URI);
  const { topic } = req.body;
  const { trackId } = req.params;
  const { userId } = req.user._id;
  const token = req.headers.authorization?.split(' ')[1];
  let threadId = null;

  try {
    await client.connect();
    console.log(`[API /tracks/:trackId/requestLesson] Connected to MongoDB`);
    const db = client.db("DatabaseAi");

    const track = await db.collection("tracks").findOne({_id: new ObjectId(trackId)});
    if (!track) {
      return res.status(404).json({ error: "Track not found" });
    }
    console.log("   Found track");
    
    threadId = crypto.randomUUID();
    console.log(`   Thread ID: ${threadId}`);

    const params = {
      subject: track.subject,
      topic,
      grade: track.grade,
    }

    const config = {
      configurable: {
        thread_id: threadId,
      },
    }

    console.log(`   Invoking agent with params: ${params} and config: ${config}`);
    const { lessonId } = await lessonCreatorAgent.invoke(params, config);
    console.log(`   Successfully invoked agent. Result lesson id:`, lessonId);
    track.lessons.push(lessonId);
    console.log("   Updated track");
    await db.collection("tracks").updateOne({_id: new ObjectId(trackId), userId}, {$set: {lessons: track.lessons}});
    console.log("   Updated track in MongoDB");
    res.status(200).json({
      lessonId
    });
  } catch (error) {
    console.error("[API /tracks/:trackId/requestLesson] Error creating lesson", error);
    res.status(500).json({ error: "Failed to create lesson" });
  } finally {
    await client.close();
    console.log("[API /tracks/:trackId/requestLesson] Closed MongoDB connection");
  }
});

module.exports = router;