const http = require('http');

const PORT = process.env.PORT || 7860;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('alive');
});

server.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

module.exports = server;
