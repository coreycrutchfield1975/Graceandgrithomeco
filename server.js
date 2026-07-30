const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

const rootDir = __dirname;

// Serve all static files first (HTML, CSS, JS, images, etc.)
app.use(express.static(rootDir, {
  maxAge: '30d',
  etag: true,
  extensions: ['html']  // serve gallery.html when /gallery is requested
}));

// Explicit images route
app.use('/images', express.static(path.join(rootDir, 'images'), {
  maxAge: '30d',
  etag: true
}));

// SPA fallback — only fire if no static file matched
app.use((req, res, next) => {
  const filePath = path.join(rootDir, req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  // If route doesn't match a file, serve index.html
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log('Grace & Grit running on port ' + PORT);
});
