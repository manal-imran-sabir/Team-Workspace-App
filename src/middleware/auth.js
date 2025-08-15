import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';


export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
  
    const userResult = await pool.query(
      'SELECT id, email, full_name FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ 
        error: 'Invalid token - user not found' 
      });
    }

    req.user = userResult.rows[0];
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(403).json({ 
      error: 'Invalid or expired token' 
    });
  }
};


export const checkTeamAccess = (requiredRole = 'viewer') => {
  return async (req, res, next) => {
    const { teamId } = req.params;
    const userId = req.user.id;

    try {
      const memberResult = await pool.query(
        `SELECT role FROM team_members 
         WHERE user_id = $1 AND team_id = $2`,
        [userId, teamId]
      );

      if (memberResult.rows.length === 0) {
        return res.status(403).json({ 
          error: 'Access denied - not a team member' 
        });
      }

      const userRole = memberResult.rows[0].role;
      const roleHierarchy = ['viewer', 'editor', 'admin', 'owner'];
      const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);
      const userRoleIndex = roleHierarchy.indexOf(userRole);

      if (userRoleIndex < requiredRoleIndex) {
        return res.status(403).json({ 
          error: `Access denied - ${requiredRole} role required` 
        });
      }

      req.userRole = userRole;
      next();
    } catch (error) {
      console.error('Team access check error:', error);
      res.status(500).json({ error: 'Server error checking team access' });
    }
  };
};

export const checkDocAccess = async (req, res, next) => {
  const { docId } = req.params;
  const userId = req.user?.id;

  try {
    const docResult = await pool.query(
      `SELECT d.*, tm.role 
       FROM docs d
       LEFT JOIN team_members tm ON d.team_id = tm.team_id AND tm.user_id = $1
       WHERE d.id = $2`,
      [userId, docId]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = docResult.rows[0];

    if (!doc.is_public && !doc.role) {
      return res.status(403).json({ 
        error: 'Access denied - document not public and user not in team' 
      });
    }

    req.document = doc;
    req.userRole = doc.role || null;
    next();
  } catch (error) {
    console.error('Document access check error:', error);
    res.status(500).json({ error: 'Server error checking document access' });
  }
};