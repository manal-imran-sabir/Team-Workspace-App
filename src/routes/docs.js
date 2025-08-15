import express from 'express';
import { nanoid } from 'nanoid';
import { pool } from '../config/database.js';
import { authenticateToken, checkTeamAccess, checkDocAccess } from '../middleware/auth.js';
import { validateDoc, validateTeamId, validateDocId } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logActivity } from '../utils/activityLogger.js';

const router = express.Router();


router.get('/team/:teamId', authenticateToken, validateTeamId, checkTeamAccess('viewer'),
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT d.*, u.full_name as created_by_name,
              COUNT(c.id) as comment_count
       FROM docs d
       LEFT JOIN users u ON d.created_by = u.id
       LEFT JOIN comments c ON d.id = c.doc_id
       WHERE d.team_id = $1
       GROUP BY d.id, u.full_name
       ORDER BY d.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [teamId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM docs WHERE team_id = $1',
      [teamId]
    );

    res.json({
      docs: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  })
);


router.post('/team/:teamId', authenticateToken, validateTeamId, validateDoc,
  checkTeamAccess('editor'), asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const { title, content = '', is_public = false } = req.body;
    const userId = req.user.id;

    const short_url = is_public ? nanoid(10) : null;

    const result = await pool.query(
      `INSERT INTO docs (title, content, is_public, short_url, team_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title, content, is_public, short_url, teamId, userId]
    );

    const doc = result.rows[0];

    await logActivity({
      event_type: 'doc_created',
      user_id: userId,
      team_id: teamId,
      doc_id: doc.id,
      message: `Document "${title}" was created`
    });

    
    req.io.to(`team_${teamId}`).emit('doc:created', {
      doc,
      user: req.user
    });

    res.status(201).json({
      message: 'Document created successfully',
      doc
    });
  })
);



router.get('/:docId', authenticateToken, validateDocId, checkDocAccess,
  asyncHandler(async (req, res) => {
    const { docId } = req.params;

    const result = await pool.query(
      `SELECT d.*, u.full_name as created_by_name, t.name as team_name
       FROM docs d
       LEFT JOIN users u ON d.created_by = u.id
       LEFT JOIN teams t ON d.team_id = t.id
       WHERE d.id = $1`,
      [docId]
    );

    const doc = result.rows[0];

    res.json({
      doc,
      user_role: req.userRole,
      can_edit: req.userRole && ['editor', 'admin', 'owner'].includes(req.userRole)
    });
  })
);



router.patch('/:docId', authenticateToken, validateDocId, checkDocAccess,
  asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { title, content, is_public } = req.body;

    if (!req.userRole || !['editor', 'admin', 'owner'].includes(req.userRole)) {
      return res.status(403).json({ error: 'Edit permission required' });
    }


    let short_url = req.document.short_url;
    if (is_public && !short_url) {
      short_url = nanoid(10);
    } else if (!is_public) {
      short_url = null;
    }

    const result = await pool.query(
      `UPDATE docs 
       SET title = COALESCE($1, title),
           content = COALESCE($2, content),
           is_public = COALESCE($3, is_public),
           short_url = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [title, content, is_public, short_url, docId]
    );

    const doc = result.rows[0];

    await logActivity({
      event_type: 'doc_updated',
      user_id: req.user.id,
      team_id: doc.team_id,
      doc_id: doc.id,
      message: `Document "${doc.title}" was updated`
    });

 
    req.io.to(`doc_${docId}`).emit('doc:updated', {
      doc,
      user: req.user
    });

    res.json({
      message: 'Document updated successfully',
      doc
    });
  })
);



router.delete('/:docId', authenticateToken, validateDocId, checkDocAccess,
  asyncHandler(async (req, res) => {
    const { docId } = req.params;

 
    if (!req.userRole || !['admin', 'owner'].includes(req.userRole)) {
      return res.status(403).json({ error: 'Admin permission required to delete documents' });
    }

    const doc = req.document;

    await pool.query('DELETE FROM docs WHERE id = $1', [docId]);

    await logActivity({
      event_type: 'doc_deleted',
      user_id: req.user.id,
      team_id: doc.team_id,
      message: `Document "${doc.title}" was deleted`
    });

    req.io.to(`team_${doc.team_id}`).emit('doc:deleted', {
      docId,
      user: req.user
    });

    res.json({ message: 'Document deleted successfully' });
  })
);

export default router;