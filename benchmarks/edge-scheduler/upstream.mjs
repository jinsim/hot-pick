import http from 'node:http';
http.createServer((req,res)=>{res.writeHead(req.url==='/redirect'?302:204,req.url==='/redirect'?{location:'https://example.invalid'}:{});res.end();}).listen(8841,'127.0.0.1');
