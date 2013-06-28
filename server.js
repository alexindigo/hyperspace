var http      = require('http')
  , path      = require('path')
  , qs        = require('querystring')

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
      times   : 1, // number of clicks until link dies
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

// creates new hash for the provided url
api.define('post/api/hash', function(req, callback)
{
  var body = new Buffer('');

  // get params
  req.on('data', function(data)
  {
    body = Buffer.concat([body, data]);

    if (body.length > 1024) return callback(new ParamError('Request body too long'));
  });

  // parse params
  req.on('end', function()
  {
    var hash, params;

    if (!(params = qs.parse(body.toString('utf8')))) return callback(new ParamError('Cannot parse request parameters'));

    // check for required parameters
    if (!params.url) return callback(new ParamError('Missing parameter: URL'));

    // check for the rest
    params.times = +params.times || defaults.times;
    // TODO: make expire smaller than default
    params.expire = params.expire || defaults.expire;

    // create new hash
    hash = createHash();

    // store hash and meta
    cache.set(hash, new Buffer(params.url), params.expire);
    cache.set(hash+':meta', {times: params.times, expire: params.expire});

    // auto cleanup
    cache.on(hash+'::removed', function(expired)
    {
      cache.remove(hash+':meta');
    });

    // return hash
    callback(null, {hash: hash});

  });
});

// fetches long url based on hash
api.define('get/api/hash/:hash', function(req, callback)
{
  // check for parameters
  // TODO: Switch to custom error
  if (!(hash = this.params.hash)) return callback(new ParamError('Missing parameter: Hash'));

  // check if hash exists
  if (!cache.has(hash)) return callback(new HashError());

  // return hash
  callback(null, {url: getURL(hash) });
});

// }}}


// {{{ start the server
http.createServer(function(req, res)
{
  var hash;

  // check for cached hashes
  if (cache.has(hash = req.url.substr(1)))
  {
    res.writeHead(307, {'Location': getURL(hash) });
    res.end();
    return;
  }

  // check for local files first
  files(req, res, function()
  {
    var match;

    // not a file, check api router
    if ((match = api.match(req.method+req.url)).perfect)
    {
      // execute matched method and be done here
      return match.fn(req, function(err, data)
      {
        var statusCode = 200
          , result = {}
          ;

        if (err)
        {
          statusCode = err.code || 400;
          result = err;
        }
        else
        {
          result = data;
        }

        res.writeHead(statusCode, {'Content-type': 'application/json'});
        res.end(JSON.stringify(result));
      });
    }

    res.writeHead(404, {'Content-type': 'text/plain'});
    return res.end('Not Found');
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

// HashError, happens when request hash doesn't exist
function ParamError(message)
{
  this.code = 400; // http code related to the error
  this.name = 'ParamError';
  this.message = message || 'Invalid parameters';
}
ParamError.prototype = new Error();
ParamError.prototype.constructor = ParamError;


// --- Santa's little helpers

// fetches URL by provided hash from the cache, updating meta data
function getURL(hash)
{
  var meta, url;

  // get url meta
  meta = cache.get(hash+':meta');
console.log(['meta', meta]);
  // get url hash and not prolong expire time
  url = cache.get(hash, true).toString('utf8');

  // update counter and when it's done clean up
  if (!--meta.times)
  {
    cache.remove(hash);
  }
  else
  {
    cache.set(hash+':meta', meta);
  }

  return url;
}

// returns unique hash of variable length
function createHash()
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
