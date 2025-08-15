import { pool } from '../config/database.js';

export async function logActivity(activity) {
  try {
    const {
      event_type,
      user_id,
      team_id = null,
      doc_id = null,
      message,
      metadata = null
    } = activity;

    await pool.query(
      `INSERT INTO activity_logs (event_type, user_id, team_id, doc_id, message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event_type, user_id, team_id, doc_id, message, metadata]
    );

    console.log(`Activity logged: ${event_type} by user ${user_id}`);
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

export async function getActivityLogs(filters = {}) {
  try {
    const {
      team_id,
      user_id,
      event_type,
      limit = 50,
      offset = 0
    } = filters;

    let query = `
      SELECT al.*, u.full_name as user_name, t.name as team_name, d.title as doc_title
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN teams t ON al.team_id = t.id
      LEFT JOIN docs d ON al.doc_id = d.id
      WHERE 1=1
    `;

    const values = [];
    let valueIndex = 1;

    if (team_id) {
      query += ` AND al.team_id = $${valueIndex}`;
      values.push(team_id);
      valueIndex++;
    }

    if (user_id) {
      query += ` AND al.user_id = $${valueIndex}`;
      values.push(user_id);
      valueIndex++;
    }

    if (event_type) {
      query += ` AND al.event_type = $${valueIndex}`;
      values.push(event_type);
      valueIndex++;
    }

    query += ` ORDER BY al.timestamp DESC LIMIT $${valueIndex} OFFSET $${valueIndex + 1}`;
    values.push(limit, offset);

    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    console.error('Failed to get activity logs:', error);
    throw error;
  }
}