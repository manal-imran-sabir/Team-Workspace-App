import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;


export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export async function initializeDatabase() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('Database connection established at:', result.rows[0].now);
    client.release();
    await createTables();
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
}

async function createTables() {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;

  const createTeamsTable = `
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_by INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;

  const createTeamMembersTable = `
    CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      team_id INT REFERENCES teams(id) ON DELETE CASCADE,
      role VARCHAR(20) CHECK (role IN ('owner', 'admin', 'editor', 'viewer')) DEFAULT 'viewer',
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, team_id)
    );
  `;

  const createDocsTable = `
    CREATE TABLE IF NOT EXISTS docs (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT DEFAULT '',
      is_public BOOLEAN DEFAULT false,
      short_url VARCHAR(20) UNIQUE,
      team_id INT REFERENCES teams(id) ON DELETE CASCADE,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;

  const createCommentsTable = `
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      doc_id INT REFERENCES docs(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;

  const createFilesTable = `
    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      doc_id INT REFERENCES docs(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      file_path TEXT NOT NULL,
      file_size INT NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMP DEFAULT NOW()
    );
  `;

  const createActivityLogsTable = `
    CREATE TABLE IF NOT EXISTS activity_logs (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      team_id INT REFERENCES teams(id) ON DELETE CASCADE,
      doc_id INT REFERENCES docs(id) ON DELETE CASCADE,
      message TEXT,
      metadata JSONB,
      timestamp TIMESTAMP DEFAULT NOW()
    );
  `;

  const queries = [
    createUsersTable,
    createTeamsTable,
    createTeamMembersTable,
    createDocsTable,
    createCommentsTable,
    createFilesTable,
    createActivityLogsTable
  ];

  for (const query of queries) {
    await pool.query(query);
  }

  console.log(' All database tables created successfully');
}


process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing database pool');
  pool.end();
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing database pool');
  pool.end();
});