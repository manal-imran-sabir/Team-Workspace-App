
import express from 'express';
import { pool } from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();


router.get('/:shortUrl', asyncHandler(async (req, res) => {
  const { shortUrl } = req.params;

  const result = await pool.query(
    `SELECT d.*, u.full_name as created_by_name, t.name as team_name
     FROM docs d
     LEFT JOIN users u ON d.created_by = u.id
     LEFT JOIN teams t ON d.team_id = t.id
     WHERE d.short_url = $1 AND d.is_public = true`,
    [shortUrl]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Document not found or not public' });
  }

  const doc = result.rows[0];
  
  const commentsResult = await pool.query(
    `SELECT c.*, u.full_name, u.avatar_url
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.doc_id = $1
     ORDER BY c.created_at ASC
     LIMIT 100`,
    [doc.id]
  );

  const filesResult = await pool.query(
    `SELECT f.id, f.filename, f.original_name, f.file_size, 
            f.mime_type, f.uploaded_at, u.full_name as uploaded_by_name
     FROM files f
     JOIN users u ON f.uploaded_by = u.id
     WHERE f.doc_id = $1
     ORDER BY f.uploaded_at DESC
     LIMIT 50`,
    [doc.id]
  );

  res.json({
    doc: {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      created_by_name: doc.created_by_name,
      team_name: doc.team_name,
      created_at: doc.created_at,
      updated_at: doc.updated_at
    },
    comments: commentsResult.rows,
    files: filesResult.rows,
    is_public_view: true
  });
}));

export default router;