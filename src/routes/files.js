import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { pool } from '../config/database.js';
import { authenticateToken, checkDocAccess } from '../middleware/auth.js';
import { validateDocId, validateId } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logActivity } from '../utils/activityLogger.js';

const router = express.Router();


const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${extension}`);
  }
});


const fileFilter = (req, file, cb) => {
  const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'), false);
  }
};


const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB default
  },
  fileFilter
});


router.post('/doc/:docId', authenticateToken, validateDocId, checkDocAccess,
  upload.single('file'), asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const userId = req.user.id;

    
    if (!req.userRole || !['editor', 'admin', 'owner'].includes(req.userRole)) {
      return res.status(403).json({ error: 'Upload permission required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = await pool.query(
      `INSERT INTO files (doc_id, filename, original_name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        docId,
        req.file.filename,
        req.file.originalname,
        req.file.path,
        req.file.size,
        req.file.mimetype,
        userId
      ]
    );

    const file = result.rows[0];

    await logActivity({
      event_type: 'file_uploaded',
      user_id: userId,
      team_id: req.document.team_id,
      doc_id: docId,
      message: `File "${req.file.originalname}" was uploaded`
    });

   
    req.io.to(`doc_${docId}`).emit('file:uploaded', {
      file,
      user: req.user
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: file.id,
        filename: file.filename,
        original_name: file.original_name,
        file_size: file.file_size,
        mime_type: file.mime_type,
        uploaded_at: file.uploaded_at
      }
    });
  })
);


router.get('/doc/:docId', authenticateToken, validateDocId, checkDocAccess,
  asyncHandler(async (req, res) => {
    const { docId } = req.params;

    const result = await pool.query(
      `SELECT f.id, f.filename, f.original_name, f.file_size, f.mime_type, 
              f.uploaded_at, u.full_name as uploaded_by_name
       FROM files f
       JOIN users u ON f.uploaded_by = u.id
       WHERE f.doc_id = $1
       ORDER BY f.uploaded_at DESC`,
      [docId]
    );

    res.json({ files: result.rows });
  })
);



router.get('/:id/download', authenticateToken, validateId, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT f.*, d.team_id, d.is_public
     FROM files f
     JOIN docs d ON f.doc_id = d.id
     WHERE f.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'File not found' });
  }

  const file = result.rows[0];

 
  if (!file.is_public) {
    const memberResult = await pool.query(
      'SELECT role FROM team_members WHERE user_id = $1 AND team_id = $2',
      [req.user.id, file.team_id]
    );

    if (memberResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  try {
    await fs.access(file.file_path);
    
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    res.setHeader('Content-Type', file.mime_type);
    
    res.sendFile(path.resolve(file.file_path));
  } catch (error) {
    console.error('File access error:', error);
    res.status(404).json({ error: 'File not found on server' });
  }
}));



router.delete('/:id', authenticateToken, validateId, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const result = await pool.query(
    `SELECT f.*, d.team_id
     FROM files f
     JOIN docs d ON f.doc_id = d.id
     WHERE f.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'File not found' });
  }

  const file = result.rows[0];

  
  const memberResult = await pool.query(
    'SELECT role FROM team_members WHERE user_id = $1 AND team_id = $2',
    [userId, file.team_id]
  );

  if (memberResult.rows.length === 0) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const userRole = memberResult.rows[0].role;
  if (file.uploaded_by !== userId && !['admin', 'owner'].includes(userRole)) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  
  try {
    await fs.unlink(file.file_path);
  } catch (error) {
    console.error('File deletion error:', error);
  }

  
  await pool.query('DELETE FROM files WHERE id = $1', [id]);

  await logActivity({
    event_type: 'file_deleted',
    user_id: userId,
    team_id: file.team_id,
    doc_id: file.doc_id,
    message: `File "${file.original_name}" was deleted`
  });

 
  req.io.to(`doc_${file.doc_id}`).emit('file:deleted', {
    fileId: id,
    user: req.user
  });

  res.json({ message: 'File deleted successfully' });
}));

export default router;