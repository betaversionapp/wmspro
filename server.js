const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.static(path.join(__dirname)));

app.get('/vendor/xlsx.full.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/xlsx/dist/xlsx.full.min.js'));
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WMS Pro server running at http://0.0.0.0:${PORT}`);
});
