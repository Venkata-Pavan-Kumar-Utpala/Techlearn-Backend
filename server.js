const express = require('express');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');

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

// ====== PROGRESS TRACKING ENDPOINTS ====== //

// Update user progress
app.post('/progress', authenticateToken, async (req, res) => {
  try {
    const { courseId, chapterId } = req.body;
    
    // Validate input
    if (!courseId || !chapterId) {
      return res.status(400).json({ error: 'Missing courseId or chapterId' });
    }

    // Update or create progress record
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

// Get user progress
app.get('/progress/:userId', authenticateToken, async (req, res) => {
  try {
    // Authorization check - allow if same user or admin
    if (req.user.userId !== req.params.userId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }x

    const progress = await Progress.find({ userId: req.params.userId })
      .sort({ updatedAt: -1 });

    // Format response with progress percentage
    const formattedProgress = progress.map(p => ({
      courseId: p.courseId,
      totalChaptersCompleted: p.completedChapters.length,
      lastCompletedAt: p.completedChapters.length > 0 
        ? Math.max(...p.completedChapters.map(c => c.completedAt))
        : null
    }));

    res.status(200).json(formattedProgress);
  } catch (err) {
    console.error('Progress fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Create sample data endpoint (for development only)
app.post('/seed-sample-data', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not allowed in production' });
  }

  try {
    // Create sample courses
    const courses = [
      { title: 'Web Development Fundamentals', description: 'Learn the basics of HTML, CSS, and JavaScript' },
      { title: 'Advanced React Patterns', description: 'Master complex React patterns and state management' },
      { title: 'Cloud Architecture', description: 'Design and deploy scalable cloud applications' }
    ];
    
    const createdCourses = await Course.insertMany(courses);
    
    // Create sample notes for the first course
    const webDevCourseId = createdCourses[0]._id;
    const sampleUserId = new mongoose.Types.ObjectId(); // Random userId
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
    
    // Create sample progress data
    const progressData = [
      {
        userId: sampleUserId,
        courseId: webDevCourseId.toString(),
        completedChapters: [
          { chapterId: 'html-basics', completedAt: new Date() },
          { chapterId: 'css-fundamentals', completedAt: new Date() }
        ]
      },
      {
        userId: sampleUserId,
        courseId: createdCourses[1]._id.toString(),
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