import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';

export function setupSocketIO(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
     
      const userResult = await pool.query(
        'SELECT id, email, full_name FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (userResult.rows.length === 0) {
        return next(new Error('User not found'));
      }

      socket.user = userResult.rows[0];
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication error'));
    }
  });


  io.on('connection', (socket) => {
    console.log(`User ${socket.user.full_name} connected: ${socket.id}`);


    
    socket.on('join_document', async (docId) => {
      try {
        const docResult = await pool.query(
          `SELECT d.*, tm.role 
           FROM docs d
           LEFT JOIN team_members tm ON d.team_id = tm.team_id AND tm.user_id = $1
           WHERE d.id = $2`,
          [socket.user.id, docId]
        );

        if (docResult.rows.length === 0) {
          return socket.emit('error', { message: 'Document not found' });
        }

        const doc = docResult.rows[0];
        if (!doc.is_public && !doc.role) {
          return socket.emit('error', { message: 'Access denied' });
        }

        socket.join(`doc_${docId}`);
        socket.currentDocId = docId;

        socket.to(`doc_${docId}`).emit('user_joined', {
          user: socket.user,
          timestamp: new Date().toISOString()
        });

        socket.emit('joined_document', { 
          docId, 
          message: `Joined document: ${doc.title}` 
        });

        console.log(`User ${socket.user.full_name} joined document ${docId}`);
      } catch (error) {
        console.error('Join document error:', error);
        socket.emit('error', { message: 'Failed to join document' });
      }
    });


    socket.on('leave_document', (docId) => {
      socket.leave(`doc_${docId}`);
      
      socket.to(`doc_${docId}`).emit('user_left', {
        user: socket.user,
        timestamp: new Date().toISOString()
      });

      if (socket.currentDocId === docId) {
        socket.currentDocId = null;
      }

      console.log(`User ${socket.user.full_name} left document ${docId}`);
    });


    socket.on('join_team', async (teamId) => {
      try {
        const memberResult = await pool.query(
          'SELECT role FROM team_members WHERE user_id = $1 AND team_id = $2',
          [socket.user.id, teamId]
        );

        if (memberResult.rows.length === 0) {
          return socket.emit('error', { message: 'Not a team member' });
        }

        socket.join(`team_${teamId}`);
        socket.emit('joined_team', { teamId, message: 'Joined team room' });

        console.log(`User ${socket.user.full_name} joined team ${teamId}`);
      } catch (error) {
        console.error('Join team error:', error);
        socket.emit('error', { message: 'Failed to join team' });
      }
    });

    
    socket.on('typing_start', (data) => {
      if (socket.currentDocId) {
        socket.to(`doc_${socket.currentDocId}`).emit('user_typing', {
          user: socket.user,
          timestamp: new Date().toISOString()
        });
      }
    });


    socket.on('typing_stop', (data) => {
      if (socket.currentDocId) {
        socket.to(`doc_${socket.currentDocId}`).emit('user_stopped_typing', {
          user: socket.user,
          timestamp: new Date().toISOString()
        });
      }
    });

 
    socket.on('cursor_position', (data) => {
      if (socket.currentDocId) {
        socket.to(`doc_${socket.currentDocId}`).emit('cursor_update', {
          user: socket.user,
          position: data.position,
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('document_edit', async (data) => {
      if (!socket.currentDocId) {
        return socket.emit('error', { message: 'Not in a document room' });
      }

      try {
        const { operation, content } = data;
        const docResult = await pool.query(
          `SELECT d.*, tm.role 
           FROM docs d
           LEFT JOIN team_members tm ON d.team_id = tm.team_id AND tm.user_id = $1
           WHERE d.id = $2`,
          [socket.user.id, socket.currentDocId]
        );

        if (docResult.rows.length === 0) {
          return socket.emit('error', { message: 'Document not found' });
        }

        const doc = docResult.rows[0];
        const userRole = doc.role;

        if (!userRole || !['editor', 'admin', 'owner'].includes(userRole)) {
          return socket.emit('error', { message: 'Edit permission required' });
        }

        socket.to(`doc_${socket.currentDocId}`).emit('document_change', {
          user: socket.user,
          operation,
          content,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('Document edit error:', error);
        socket.emit('error', { message: 'Failed to process document edit' });
      }
    });

   
    socket.on('disconnect', () => {
      console.log(`User ${socket.user.full_name} disconnected: ${socket.id}`);
      
      if (socket.currentDocId) {
        socket.to(`doc_${socket.currentDocId}`).emit('user_left', {
          user: socket.user,
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
      socket.emit('error', { message: 'Connection error occurred' });
    });
  });

  console.log('Socket.IO configured successfully');
}