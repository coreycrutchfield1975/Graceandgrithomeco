const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const rootDir = __dirname;

// Serve static files
app.use(express.static(rootDir, {
  maxAge: '30d',
  etag: true
}));

app.listen(PORT, () => {
  console.log('Grace & Grit running on port ' + PORT);
});
