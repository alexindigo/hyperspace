var http = require('http')
  ;

http.createServer(function(req, res)
{
  var time = process.hrtime() // get unique number
    , salt = Math.floor(Math.random() * Math.pow(10, Math.random()*10)) // get variable length prefix
    , hash = salt.toString(36) + time[1].toString(36) + time[0].toString(36) // construct unique id
    ;

  res.writeHead(200, {'Content-type': 'text/html'});
  res.end('Mmm: '+hash+'\n');

}).listen(8300);
