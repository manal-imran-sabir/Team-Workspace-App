import express from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, checkDocAccess } from '../middleware/auth.js';
import { validateComment, validateDocId, validateId } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logActivity } from '../utils/activityLogger.js';

const router = express.Router();

router.get('/doc/:docId', authenticateToken, validateDocId, checkDocAccess,
  asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT c.*, u.full_name, u.avatar_url
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.doc_id = $1
       ORDER BY c.created_at ASC
       LIMIT $2 OFFSET $3`,
      [docId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM comments WHERE doc_id = $1',
      [docId]
    );

    res.json({
      comments: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  })
);



router.post('/doc/:docId', authenticateToken, validateDocId, validateComment, 
  checkDocAccess, asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { message } = req.body;
    const userId = req.user.id;

    if (!req.userRole && !req.document.is_public) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `INSERT INTO comments (doc_id, user_id, message)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [docId, userId, message]
    );

    const commentResult = await pool.query(
      `SELECT c.*, u.full_name, u.avatar_url
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = $1`,
      [result.rows[0].id]
    );

    const comment = commentResult.rows[0];

    await logActivity({
      event_type: 'comment_added',
      user_id: userId,
      team_id: req.document.team_id,
      doc_id: docId,
      message: `Comment added to document "${req.document.title}"`
    });

 
    req.io.to(`doc_${docId}`).emit('comment:new', {
      comment,
      user: req.user
    });

    res.status(201).json({
      message: 'Comment added successfully',
      comment
    });
  })
);



router.patch('/:id', authenticateToken, validateId, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  const userId = req.user.id;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Comment message is required' });
  }

  
  const commentResult = await pool.query(
    'SELECT * FROM comments WHERE id = $1',
    [id]
  );

  if (commentResult.rows.length === 0) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  const comment = commentResult.rows[0];

  if (comment.user_id !== userId) {
    return res.status(403).json({ error: 'Can only edit your own comments' });
  }

 
  const result = await pool.query(
    `UPDATE comments 
     SET message = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [message.trim(), id]
  );

  const updatedResult = await pool.query(
    `SELECT c.*, u.full_name, u.avatar_url
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.id = $1`,
    [id]
  );

  const updatedComment = updatedResult.rows[0];


  req.io.to(`doc_${comment.doc_id}`).emit('comment:updated', {
    comment: updatedComment,
    user: req.user
  });

  res.json({
    message: 'Comment updated successfully',
    comment: updatedComment
  });
}));



router.delete('/:id', authenticateToken, validateId, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const commentResult = await pool.query(
    'SELECT * FROM comments WHERE id = $1',
    [id]
  );

  if (commentResult.rows.length === 0) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  const comment = commentResult.rows[0];

  if (comment.user_id !== userId) {
    return res.status(403).json({ error: 'Can only delete your own comments' });
  }

  await pool.query('DELETE FROM comments WHERE id = $1', [id]);


  req.io.to(`doc_${comment.doc_id}`).emit('comment:deleted', {
    commentId: id,
    user: req.user
  });

  res.json({ message: 'Comment deleted successfully' });
}));

export default router;