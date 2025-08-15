import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateRegister, validateLogin } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

router.post('/register', validateRegister, asyncHandler(async (req, res) => {
  const { email, password, full_name } = req.body;

  const existingUser = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existingUser.rows.length > 0) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const saltRounds = 12;
  const password_hash = await bcrypt.hash(password, saltRounds);


  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) 
     VALUES ($1, $2, $3) 
     RETURNING id, email, full_name, created_at`,
    [email, password_hash, full_name]
  );

  const user = result.rows[0];


  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.status(201).json({
    message: 'User created successfully',
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      created_at: user.created_at
    },
    token
  });
}));



router.post('/login', validateLogin, asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  
  const result = await pool.query(
    'SELECT id, email, password_hash, full_name FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const user = result.rows[0];

  
  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({
    message: 'Login successful',
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name
    },
    token
  });
}));




router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, email, full_name, avatar_url, created_at 
     FROM users WHERE id = $1`,
    [req.user.id]
  );

  res.json({ user: result.rows[0] });
}));


router.patch('/me', authenticateToken, asyncHandler(async (req, res) => {
  const { full_name, avatar_url } = req.body;
  const userId = req.user.id;

  const result = await pool.query(
    `UPDATE users 
     SET full_name = COALESCE($1, full_name),
         avatar_url = COALESCE($2, avatar_url),
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, email, full_name, avatar_url`,
    [full_name, avatar_url, userId]
  );

  res.json({
    message: 'Profile updated successfully',
    user: result.rows[0]
  });
}));

export default router;