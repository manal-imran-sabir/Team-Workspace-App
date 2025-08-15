import express from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, checkTeamAccess } from '../middleware/auth.js';
import { validateTeam, validateInvite, validateTeamId } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logActivity } from '../utils/activityLogger.js';

const router = express.Router();


router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await pool.query(
    `SELECT t.*, tm.role, tm.joined_at,
            u.full_name as created_by_name,
            COUNT(DISTINCT tm2.id) as member_count,
            COUNT(DISTINCT d.id) as doc_count
     FROM teams t
     JOIN team_members tm ON t.id = tm.team_id
     LEFT JOIN users u ON t.created_by = u.id
     LEFT JOIN team_members tm2 ON t.id = tm2.team_id
     LEFT JOIN docs d ON t.id = d.team_id
     WHERE tm.user_id = $1
     GROUP BY t.id, tm.role, tm.joined_at, u.full_name
     ORDER BY tm.joined_at DESC`,
    [userId]
  );

  res.json({ teams: result.rows });
}));



router.post('/', authenticateToken, validateTeam, asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const teamResult = await client.query(
      `INSERT INTO teams (name, description, created_by) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [name, description, userId]
    );

    const team = teamResult.rows[0];

    await client.query(
      `INSERT INTO team_members (user_id, team_id, role) 
       VALUES ($1, $2, 'owner')`,
      [userId, team.id]
    );

    await client.query('COMMIT');

    await logActivity({
      event_type: 'team_created',
      user_id: userId,
      team_id: team.id,
      message: `Team "${name}" was created`
    });

    res.status(201).json({
      message: 'Team created successfully',
      team
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));



router.get('/:teamId', authenticateToken, validateTeamId, checkTeamAccess('viewer'), 
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;

    const result = await pool.query(
      `SELECT t.*, u.full_name as created_by_name,
              COUNT(DISTINCT tm.id) as member_count,
              COUNT(DISTINCT d.id) as doc_count
       FROM teams t
       LEFT JOIN users u ON t.created_by = u.id
       LEFT JOIN team_members tm ON t.id = tm.team_id
       LEFT JOIN docs d ON t.id = d.team_id
       WHERE t.id = $1
       GROUP BY t.id, u.full_name`,
      [teamId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }

    res.json({ 
      team: result.rows[0],
      user_role: req.userRole
    });
  })
);



router.patch('/:teamId', authenticateToken, validateTeamId, checkTeamAccess('admin'),
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const { name, description } = req.body;

    const result = await pool.query(
      `UPDATE teams 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [name, description, teamId]
    );

    await logActivity({
      event_type: 'team_updated',
      user_id: req.user.id,
      team_id: teamId,
      message: `Team details were updated`
    });

    res.json({
      message: 'Team updated successfully',
      team: result.rows[0]
    });
  })
);



router.get('/:teamId/members', authenticateToken, validateTeamId, checkTeamAccess('viewer'),
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;

    const result = await pool.query(
      `SELECT tm.*, u.full_name, u.email, u.avatar_url
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1
       ORDER BY 
         CASE tm.role 
           WHEN 'owner' THEN 1 
           WHEN 'admin' THEN 2 
           WHEN 'editor' THEN 3 
           WHEN 'viewer' THEN 4 
         END,
         tm.joined_at ASC`,
      [teamId]
    );

    res.json({ members: result.rows });
  })
);



router.post('/:teamId/invite', authenticateToken, validateTeamId, validateInvite, 
  checkTeamAccess('admin'), asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const { email, role } = req.body;
    const inviterId = req.user.id;
    const userResult = await pool.query(
      'SELECT id, full_name FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    const existingMember = await pool.query(
      'SELECT id FROM team_members WHERE user_id = $1 AND team_id = $2',
      [user.id, teamId]
    );

    if (existingMember.rows.length > 0) {
      return res.status(409).json({ error: 'User is already a team member' });
    }

    await pool.query(
      'INSERT INTO team_members (user_id, team_id, role) VALUES ($1, $2, $3)',
      [user.id, teamId, role]
    );

    await logActivity({
      event_type: 'member_invited',
      user_id: inviterId,
      team_id: teamId,
      message: `${user.full_name} was invited to the team as ${role}`
    });

    res.status(201).json({
      message: 'User invited successfully',
      member: {
        user_id: user.id,
        full_name: user.full_name,
        email,
        role
      }
    });
  })
);



router.patch('/:teamId/members/:memberId', authenticateToken, validateTeamId,
  checkTeamAccess('admin'), asyncHandler(async (req, res) => {
    const { teamId, memberId } = req.params;
    const { role } = req.body;

    if (!['viewer', 'editor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

   
    const memberResult = await pool.query(
      'SELECT user_id, role FROM team_members WHERE id = $1 AND team_id = $2',
      [memberId, teamId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const member = memberResult.rows[0];
    if (member.role === 'owner') {
      return res.status(403).json({ error: 'Cannot change owner role' });
    }

   
    await pool.query(
      'UPDATE team_members SET role = $1 WHERE id = $2',
      [role, memberId]
    );

    await logActivity({
      event_type: 'member_role_updated',
      user_id: req.user.id,
      team_id: teamId,
      message: `Member role was updated to ${role}`
    });

    res.json({ message: 'Member role updated successfully' });
  })
);


router.delete('/:teamId/members/:memberId', authenticateToken, validateTeamId,
  checkTeamAccess('admin'), asyncHandler(async (req, res) => {
    const { teamId, memberId } = req.params;
    const memberResult = await pool.query(
      'SELECT user_id, role FROM team_members WHERE id = $1 AND team_id = $2',
      [memberId, teamId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const member = memberResult.rows[0];
    if (member.role === 'owner') {
      return res.status(403).json({ error: 'Cannot remove team owner' });
    }

    await pool.query(
      'DELETE FROM team_members WHERE id = $1',
      [memberId]
    );

    await logActivity({
      event_type: 'member_removed',
      user_id: req.user.id,
      team_id: teamId,
      message: 'A member was removed from the team'
    });

    res.json({ message: 'Member removed successfully' });
  })
);

export default router;