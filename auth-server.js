const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const User = require('./models/User');
const RefreshToken = require('./models/RefreshToken');
const rateLimit = require('express-rate-limit');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('🔐 Auth Server connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many attempts, please try again later'
});

// Token Generation
function generateAccessToken(user) {
  return jwt.sign(
    { 
      userId: user._id, 
      name: user.name,
      isAdmin: user.isAdmin || false
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '15m' } 
  );
}

// Token endpoint
app.post('/token', async (req, res) => {
  const refreshToken = req.body.token;
  if (!refreshToken) return res.sendStatus(401);

try {
    // Check if token exists in DB
    const storedToken = await RefreshToken.findOne({ token: refreshToken });
    if (!storedToken) return res.sendStatus(403);

    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, async (err, decoded) => {
      if (err) {
        // Delete invalid refresh tokens
        await RefreshToken.deleteOne({ token: refreshToken });
        return res.sendStatus(403);
      }
      
      const user = await User.findById(decoded.userId);
      if (!user) return res.sendStatus(404);
      
      const accessToken = generateAccessToken(user);
      res.json({ accessToken });
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.sendStatus(500);
  }
});

// Register endpoint
app.post('/register', authLimiter, async (req, res) => {
  try {
    // Validate username
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(req.body.name)) {
      return res.status(400).json({
        error: 'Username must be 3-20 characters (letters, numbers, underscores)'
      });
    }

    // Validate password
    const passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}$/;
    if (!passwordRegex.test(req.body.password)) {
      return res.status(400).json({
        error: 'Password must contain: 8+ chars, 1 uppercase, 1 lowercase, 1 number'
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ name: req.body.name });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    
    const newUser = new User({
      name: req.body.name,
      password: hashedPassword,
      isAdmin: req.body.isAdmin || false
    });
    
    await newUser.save();
    
    res.status(201).json({
      message: 'User created successfully',
      user: { id: newUser._id, name: newUser.name }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login endpoint
app.post('/login', authLimiter, async (req, res) => {
  try {
    const user = await User.findOne({ name: req.body.name });
    if (!user) {
      // Simulate similar timing to prevent username enumeration
      await bcrypt.compare('dummy', '$2b$10$dummyhashdummyhashdummyha');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(req.body.password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = generateAccessToken(user);
    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: '7d' }
    );

    // Save refresh token to DB
    await new RefreshToken({
      token: refreshToken,
      userId: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }).save();

    // Return tokens
    res.json({
      accessToken,
      refreshToken,
      userId: user._id,
      name: user.name,
      isAdmin: user.isAdmin || false
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});


// Logout endpoint
app.delete('/logout', async (req, res) => {
  try {
    await RefreshToken.deleteOne({ token: req.body.token });
    res.sendStatus(204);
  } catch (err) {
    console.error('Logout error:', err);
    res.sendStatus(500);
  }
});

app.listen(4000, () => console.log('🔐 Auth Server running on port 4000'));