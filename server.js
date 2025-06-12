const express = require('express');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const apicache = require('apicache');

// Import models
const Course = require('./models/Course');
const Note = require('./models/Note');
const Progress = require('./models/Progress'); 

dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 5000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('📚 TechLearn API connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Missing authentication token' });

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(403).json({ error: 'Invalid token' });
    }
    
    req.user = {
      userId: decoded.userId,
      name: decoded.name,
      isAdmin: decoded.isAdmin || false
    };
    next();
  });
}

// Get all courses
app.get('/courses', authenticateToken, async (req, res) => {
  try {
    const courses = await Course.find();
    res.json(courses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Get notes for a specific course
app.get('/courses/:id/notes', authenticateToken, async (req, res) => {
  try {
    // Validate course ID format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid course ID format' });
    }

    const courseId = new mongoose.Types.ObjectId(req.params.id);
    
    // Get notes for this course and user
    const notes = await Note.find({
      courseId: courseId,
      userId: req.user.userId
    });
    
    if (!notes || notes.length === 0) {
      return res.status(404).json({ 
        message: 'No notes found for this course',
        courseId: req.params.id
      });
    }
    
    res.json(notes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Progress Tracking

// Rate limiting
const progressLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  message: 'Too many progress updates, please try again later'
});

// Update user progress
app.post('/progress', authenticateToken, progressLimiter, async (req, res) => {
  try {
    const { courseId, chapterId } = req.body;

    // Validate input
    if (!courseId || !chapterId) {
      return res.status(400).json({ error: 'Missing courseId or chapterId' });
    }

    // Check if the course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check if the chapter exists in that course
    const chapterExists = course.chapters.some(ch => ch.id === chapterId || ch._id?.toString() === chapterId);
    if (!chapterExists) {
      return res.status(404).json({ error: 'Chapter not found in course' });
    }

    // Update or insert user progress
    const progress = await Progress.findOneAndUpdate(
      { userId: req.user.userId, courseId },
      { 
        $addToSet: { 
          completedChapters: { 
            chapterId,
            completedAt: new Date()
          } 
        } 
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(200).json(progress);
  } catch (err) {
    console.error('Progress update error:', err);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Get user progress (with caching)

const cache = apicache.middleware;
app.get('/progress/:userId', authenticateToken, cache('5 minutes'), async (req, res) => {
  try {
    // Authorization check - allow if same user or admin
    if (req.user.userId !== req.params.userId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    const progressList = await Progress.find({ userId: req.params.userId }).sort({ updatedAt: -1 });

    // Format response with progress percentage and lastCompletedAt
    const formattedProgress = await Promise.all(
      progressList.map(async (p) => {
        const course = await Course.findById(p.courseId);
        const totalChapters = course ? course.chapters.length : 0;
        const completedChapters = p.completedChapters || [];

        const lastCompletedAt = completedChapters.length > 0
          ? completedChapters.reduce(
              (latest, chapter) => chapter.completedAt > latest ? chapter.completedAt : latest,
              completedChapters[0].completedAt
            )
          : null;

        return {
          _id: p._id,
          courseId: p.courseId,
          completedChapters,
          totalChaptersCompleted: completedChapters.length,
          lastCompletedAt,
          progressPercentage: totalChapters > 0
            ? Math.round((completedChapters.length / totalChapters) * 100)
            : 0
        };
      })
    );

    res.status(200).json(formattedProgress);
  } catch (err) {
    console.error('Progress fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Creating Sample Data to test out the API (only for development)
app.post('/seed-sample-data', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not allowed in production' });
  }

  try {
    // Define sample courses with chapters
    const courses = [
      {
        title: 'Web Development Fundamentals',
        description: 'Learn the basics of HTML, CSS, and JavaScript',
        chapters: [
          { id: 'html-basics', title: 'HTML Basics' },
          { id: 'css-fundamentals', title: 'CSS Fundamentals' },
          { id: 'js-dom', title: 'JavaScript & DOM Manipulation' }
        ]
      },
      {
        title: 'Advanced React Patterns',
        description: 'Master complex React patterns and state management',
        chapters: [
          { id: 'react-hooks', title: 'Using React Hooks' },
          { id: 'context-api', title: 'Context API & State Sharing' },
          { id: 'render-optimizations', title: 'Render Optimizations' }
        ]
      },
      {
        title: 'Cloud Architecture',
        description: 'Design and deploy scalable cloud applications',
        chapters: [
          { id: 'cloud-design', title: 'Cloud Design Patterns' },
          { id: 'microservices', title: 'Microservices Architecture' },
          { id: 'devops', title: 'CI/CD and DevOps' }
        ]
      }
    ];

    // Insert courses
    const createdCourses = await Course.insertMany(courses);

    const webDevCourseId = createdCourses[0]._id;
    const sampleUserId = new mongoose.Types.ObjectId(); // Random userId

    // Create notes for Web Development Fundamentals
    const notes = [
      {
        courseId: webDevCourseId,
        userId: sampleUserId,
        title: 'HTML Structure',
        content: 'HTML documents are structured with semantic elements like <header>, <main>, <footer>',
        tags: ['html', 'basics']
      },
      {
        courseId: webDevCourseId,
        userId: sampleUserId,
        title: 'CSS Flexbox',
        content: 'Flexbox makes responsive layouts much easier to implement',
        tags: ['css', 'layout']
      },
      {
        courseId: webDevCourseId,
        userId: sampleUserId,
        title: 'DOM Manipulation',
        content: 'JavaScript can modify the DOM to create dynamic interfaces',
        tags: ['javascript', 'dom']
      }
    ];

    await Note.insertMany(notes);

    // Create progress entries
    const progressData = [
      {
        userId: sampleUserId.toString(),
        courseId: webDevCourseId.toString(),
        completedChapters: [
          { chapterId: 'html-basics', completedAt: new Date() },
          { chapterId: 'css-fundamentals', completedAt: new Date() }
        ]
      },
      {
        userId: sampleUserId.toString(),
        courseId: createdCourses[1]._id.toString(), // Advanced React
        completedChapters: [
          { chapterId: 'react-hooks', completedAt: new Date() }
        ]
      }
    ];

    await Progress.insertMany(progressData);

    res.json({
      message: 'Sample data created successfully',
      courses: createdCourses.length,
      notes: notes.length,
      progress: progressData.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create sample data' });
  }
});

app.listen(PORT, () => console.log(`📚 TechLearn API running on port ${PORT}`));