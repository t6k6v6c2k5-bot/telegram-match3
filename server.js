const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Отдаём статические файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

// На случай прямого захода на корень (SPA-стиль)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Match-3 Telegram Mini App сервер запущен на порту ${PORT}`);
  console.log(`Открой http://localhost:${PORT} в браузере для локального теста`);
});
