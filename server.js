var http      = require('http')
  , path      = require('path')

  // thrid-party
  , st        = require('st')
  , Expirable = require('expirable')
  , MapleTree = require('mapleTree')

  // globals
  , files // router for static file
  , api // router for api calls
  , cache // cache manager

  // config
  , config    =
    {
      port    : 8300,
      path    : 'static',
      index   : 'index.html',
    }

  , defaults  =
    {
      expire  : 1000 * 60 * 60 * 3, // 3 hours
    }
  ;

// {{{ prepare environment

// process config settings
config.host = getConfigVar('host');

config.port = getConfigVar('port') || config.port;

config.index = getConfigVar('index') || config.index;

config.path = getConfigVar('path') || config.path;
if (config.path[0] != '/') config.path = path.join(__dirname, config.path);

// prepare cache manager
cache = new Expirable(defaults.expire);

// prepare static router
files = st(
{
  path       : config.path,
  url        : '/',
  passthrough: true, // no 404 for files
  index      : config.index,
  content    :
  {
    max      : 1024*1024*64, // memory limit for cache
    maxAge   : 1000*60*10, // time limit for content cache
  }
});

// prepare api router
api = new MapleTree.RouteTree();

// }}}

// {{{ define api
// Note: workaround to make it restful

// creates new hash-url pair
api.define('post/api/url/:url', function(callback)
{
  var hash, url;

  // check for parameters
  if (!(url = this.params.url)) return callback(new Error('Missing parameter: URL'));

  // create new hash
  hash = getHash();

  // store pair
  cache.set(hash, new Buffer(this.params.url));

  // return hash
  callback(null, {hash: hash});
});

// fetches long url based on hash
api.define('get/api/url/:hash', function(callback)
{
  var url, hash;

  // check for parameters
  // TODO: Switch to custom error
  if (!(hash = this.params.hash)) return callback(new Error('Missing parameter: Hash'));

  // check if hash exists
  if (!cache.has(hash)) return callback(new HashError());

  // get url hash and not prolong expire time
  url = cache.get(hash, true).toString('utf8');

  // TODO: update counter

  // return hash
  callback(null, {url: url});
});

// }}}


// {{{ start the server
http.createServer(function(req, res)
{
  // check for local files first
  files(req, res, function()
  {
    var match;

    // not a file, check api router
    if ((match = api.match(req.method+req.url)).perfect)
    {
      // execute matched method and be done here
      return match.fn(function(err, data)
      {
        var statusCode = 200
          , result = {}
          ;

        if (err)
        {
          statusCode = err.code || 400;

          // wrap up result object
          result.status = 'not';
          result.error = err;
        }
        else
        {
          // wrap up result object
          result.status = 'ok';
          result.data = data;
        }

        res.writeHead(statusCode, {'Content-type': 'application/json'});
        res.end(JSON.stringify(result));
      });
    }

    res.writeHead(404, {'Content-type': 'text/plain'});
    return res.end('END: '+getHash()+' : '+getHash()+'\n');
  });

}).listen(config.port, config.host);
console.log('listening on '+(config.host ? config.host + ':' : '')+config.port);
// }}}

// --- Custom errors

// HashError, happens when request hash doesn't exist
function HashError(message)
{
  this.code = 404; // http code related to the error
  this.name = 'HashError';
  this.message = message || 'Hash doesn\'t exist';
}
HashError.prototype = new Error();
HashError.prototype.constructor = HashError;

// --- Santa's little helpers

// returns unique hash of variable length
function getHash()
{
  var time = process.hrtime() // get unique number
    , salt = Math.floor(Math.random() * Math.pow(10, Math.random()*10)) // get variable length prefix
    , hash = salt.toString(36) + time[1].toString(36) + time[0].toString(36) // construct unique id
    ;

  return hash;
}

// fetches variable from environment or npm config
// TODO: Should we account for 0?
function getConfigVar(key)
{
  return process.env[key] || process.env['npm_package_config_'+key] || null;
}
