export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  let error = {
    message: err.message || 'Internal Server Error',
    status: err.status || 500
  };

  
  if (err.code === '23505') { 
    error.message = 'Resource already exists';
    error.status = 409;
  }

  if (err.code === '23503') { 
    error.message = 'Referenced resource not found';
    error.status = 400;
  }

  if (err.code === '42P01') { 
    error.message = 'Database configuration error';
    error.status = 500;
  }

  
  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid token';
    error.status = 401;
  }

  if (err.name === 'TokenExpiredError') {
    error.message = 'Token expired';
    error.status = 401;
  }

  
  if (err.code === 'LIMIT_FILE_SIZE') {
    error.message = 'File too large';
    error.status = 413;
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    error.message = 'Unexpected file field';
    error.status = 400;
  }

  
  res.status(error.status).json({
    error: error.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Used https://www.postgresql.org/docs/current/errcodes-appendix.html for error codes