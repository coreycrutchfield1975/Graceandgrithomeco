const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve all static files from the deployment root
const rootDir = __dirname;
console.log('Serving from:', rootDir);
console.log('Files:', fs.readdirSync(rootDir).slice(0, 20));

app.use(express.static(rootDir, {
  maxAge: '30d',
  etag: true
}));

// Explicit route for images
app.use('/images', express.static(path.join(rootDir, 'images'), {
  maxAge: '30d',
  etag: true
}));

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log('Grace & Grit running on port ' + PORT);
});
