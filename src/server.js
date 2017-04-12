#!/usr/bin/env node
/**
 *
 * The Bipio API Server
 *
 * Copyright (c) 2017 InterDigital, Inc. All Rights Reserved
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
var bootstrap = require(__dirname + '/bootstrap'),
  app = bootstrap.app,
  cluster = require('cluster'),
  express = require('express'),
  restapi = express(),
  http = require('http'),
  https = require('https'),
  session = require('express-session'),
  cookieParser = require('cookie-parser'),
  bodyParser = require('body-parser'),
  jsonp = require('json-middleware'),
  methodOverride = require('method-override'),
  multer = require('multer'),
  helper  = require('./lib/helper'),
  passport = require('passport'),
  cron = require('cron'),
  MongoStore = require('connect-mongo')({ session : session}),
  domain = require('domain'),
  jwt = require('jsonwebtoken'),
  pkg = require('../package.json'),
  bipioVersion = pkg.version;

// export app everywhere
module.exports.app = app;

/**
 * express bodyparser looks broken or too strict.
 */
function xmlBodyParser(req, res, next) {
  var enc = helper.getMime(req);
  if (req._body) return next();
  req.body = req.body || {};

  // ignore GET
  if ('GET' == req.method || 'HEAD' == req.method) return next();

  // check Content-Type
  if (!/xml/.test(enc)) {
    return next();
  }

  // flag as parsed
  req._body = true;

  // parse
  var buf = '';
  req.setEncoding('utf8');
  req.rawBody = '';

  req.on('data', function(chunk) {
    req.rawBody += chunk;
  });
  req.on('end', function(){
    next();
  });
}


// some people expect json parsing even when not sending
// a content type, so try our hardest to provide and parse the request body
function rawBodyParser(req, res, next) {
  var contentType = req.headers['content-type'] || '',
    mime = contentType.split(';')[0];

  req.rawBody = '';
  req.on('data', function(chunk) {
    var buf = req.rawBody + chunk;
    // don't buffer payloads which are too large
    if (buf.length <= 1024 * 1024) {
      req.rawBody = buf;
    }
  });

  req.on('end', function() {
    if (req.body && req.body.body && !app.helper.isObject(req.body.body)) {
      try {
        req.body.body = JSON.parse(req.body.body);
      } catch (e) {

      }
    }

    if ( (!req.body || (app.helper.isObject(req.body) && !Object.keys(req.body).length ))  && req.rawBody) {
     try {
        req.body = JSON.parse(req.rawBody);
      } catch (e) {

      }
    }
  });

  next();
}

function _jwtDeny(res, extra) {
  res.status(403).send('Invalid X-JWT-Signature ' + (extra ? '- ' + extra : ''));
}

// if user has provided a jwt header, try to parse
function jwtConfirm(req, res, next) {
  var masq = req.header('x-user-delegate'),
    token = req.header('x-jwt-signature'),
    structedMethods = [ 'POST', 'PUT', 'PATCH'],
    payload = {};

  if (token) {
    if (structedMethods.indexOf(req.method)) {
      payload = req.body;
    }

    try {
      jwt.verify(token, GLOBAL.CFG.jwtKey, function(err, decoded) {
        var remoteHost = req.header('X-Forwarded-For') || req.connection.remoteAddress;
        if (err) {
          app.logmessage(err.message + ' (IP ' + remoteHost + ')');
          _jwtDeny(res, err.message);
        } else {
          try {
            if (decoded.path === req.originalUrl) {
              // && JSON.stringify(decoded.body) === JSON.stringify(req.body)) {

              if (decoded.user === masq) {
                req.masqUser = masq;
              }

              next();
            } else {
              _jwtDeny(res);
            }
          } catch (e) {
            app.logmessage(e.message, 'error');
            _jwtDeny(res, e.message);
          }
        }
      });
    } catch (e) {
      // jsonwebtoken doesn't catch parse errors by itself.
      app.logmessage(e.message, 'error');
      _jwtDeny(res, e.message);
    }

  } else {
    next();
  }
}

function setCORS(req, res, next) {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.header('Access-Control-Allow-Methods', req.headers['access-control-request-method'] || 'GET,POST,PUT,DELETE,PATCH');
  res.header('Access-Control-Allow-Credentials', true);
  next();
}

//
// ------ LOAD EXPRESS MIDDLEWARE
//
restapi.use(app.modules.cdn.utils.HTTPFormHandler());

restapi.use(xmlBodyParser);
restapi.use(function(err, req, res, next) {
  if (err.status == 400) {
    restapi.logmessage(err, 'error');
    res.send(err.status, {
      message : 'Invalid JSON. ' + err
    });
  } else {
    next(err, req, res, next);
  }
});

restapi.use(bodyParser.urlencoded({ extended : true }));

// if there's no content type set, try to parse it as json
restapi.use(function(req, res, next) {
  if (!req.headers['content-type'] && ('PUT' === req.method || 'POST' === req.method || 'PATCH' === req.method) ) {
    req.headers['content-type'] = 'application/json';
  }
  next();
});

restapi.use(rawBodyParser);
restapi.use(bodyParser.json());

// if there looks to be a body that's a json string, then try
// casting it to json
/*
restapi.use(function(req, res, next) {
  req.on('end', function() {
    if (req.body && req.body.body && !app.helper.isObject(req.body.body)) {
      try {
        req.body.body = JSON.parse(req.body.body);
      } catch (e) {

      }
    }
  console.log('trying to parse rawBody ', req.rawBody);
    if (!req.body && req.rawBody) {
     try {
        req.body = JSON.parse(req.rawBody);
      } catch (e) {

      }
    }

    next();

  });
});
*/

restapi.use(jwtConfirm);

restapi.use(setCORS);
restapi.use(methodOverride());
restapi.use(cookieParser());

// required for some oauth providers
restapi.use(session({
  key : 'sid',
  resave : false,
  saveUninitialized : true,
  cookie: {
    maxAge: null,
    httpOnly : true
  },
  secret: GLOBAL.CFG.server.sessionSecret,
  store: new MongoStore({
    mongooseConnection : app.dao.getConnection()
  })
}));

restapi.use(passport.initialize());
restapi.use(passport.session());

restapi.set('jsonp callback', true );
restapi.disable('x-powered-by');

//
// ------ START CLUSTER
//
if (cluster.isMaster) {
  // when user hasn't explicitly configured a cluster size, use 1 process per cpu
  var forks = (undefined !== GLOBAL.CFG.server.forks) ? GLOBAL.CFG.server.forks : require('os').cpus().length;
  app.logmessage('BIPIO:STARTED:' + new Date());
  app.logmessage('Node v' + process.versions.node);
  app.logmessage('Starting ' + forks + ' fork(s)');

  for (var i = 0; i < forks; i++) {
    cluster.fork();
  }

  app.dao.on('ready', function(dao) {
    var crons = GLOBAL.CFG.crons;

    // Network chords and stats summaries
    if (crons && crons.stat && '' !== crons.stat) {
      app.logmessage('DAO:Starting Stats Cron', 'info');
      var statsJob = new cron.CronJob(crons.stat, function() {
        dao.generateHubStats(function(err, msg) {
          if (err) {
            app.logmessage('STATS:THERE WERE ERRORS');
          } else {
            app.logmessage(msg);
            app.logmessage('STATS:DONE');
          }
        });
      }, null, true, GLOBAL.CFG.timezone);
    }

    // periodic triggers
    if (crons && crons.trigger && '' !== crons.trigger) {
      app.logmessage('DAO:Starting Trigger Cron', 'info');
      var triggerJob = new cron.CronJob(crons.trigger, function() {
        dao.triggerAll(function(err, msg) {
          if (err) {
            app.logmessage('TRIGGER:' + err + ' ' + msg);
          } else {
            app.logmessage(msg);
            app.logmessage('TRIGGER:DONE');
          }
        });
      }, null, true, GLOBAL.CFG.timezone);
    }

    // auto-expires
    if (crons && crons.expire && '' !== crons.expire) {
      app.logmessage('DAO:Starting Expiry Cron', 'info');
      var expireJob = new cron.CronJob(crons.expire, function() {
        dao.expireAll(function(err, msg) {
          if (err) {
            app.logmessage('EXPIRE:ERROR:' + err);
            app.logmessage(msg);
          } else {
            app.logmessage('EXPIRE:DONE');
          }
        });
      }, null, true, GLOBAL.CFG.timezone);
    }

    // oAuth refresh
    app.logmessage('DAO:Starting OAuth Refresh', 'info');
    var oauthRefreshJob = new cron.CronJob('0 */20 * * * *', function() {
      dao.refreshOAuth();
    }, null, true, GLOBAL.CFG.timezone);

   // compile popular transforms into transform_defaults.
    if (crons && crons.transforms_compact && '' !== crons.transforms_compact) {
  		app.logmessage('DAO:Starting Transform Compaction Cron', 'info');
  		var reduceTransformsJob = new cron.CronJob(crons.transforms_compact, function() {
        bootstrap.app.dao.reduceTransformDefaults(function(err, msg) {
          if (err) {
            app.logmessage('DAO:' + err + ' ' + msg);
          } else {
            app.logmessage('DAO:Transform Compaction:Done');
          }
        });
  		}, null, true, GLOBAL.CFG.timezone);
  	}

    // fetch scrubbed community transforms from upstream
    if (GLOBAL.CFG.transforms && GLOBAL.CFG.transforms.fetch) {
      if (crons && crons.transforms_fetch && '' !== crons.transforms_fetch) {
        app.logmessage('DAO:Starting Transform Syncing Cron', 'info');
        var syncTransformsJob = new cron.CronJob(crons.transforms_fetch, function() {
          dao.updateTransformDefaults( function() {
            app.logmessage('DAO:Syncing Transforms:Done');
          });
        }, null, true, GLOBAL.CFG.timezone);
      }
    }
  });

  cluster.on('disconnect', function(worker) {
    app.logmessage('Worker:' + worker.workerID + ':Disconnect');
    cluster.fork();
  });
}
if (!cluster.isMaster || !GLOBAL.CFG.server.forks) {

  workerId = cluster.worker ? cluster.worker.workerID : process.pid;
  app.logmessage('BIPIO:STARTED:' + new Date());
  helper.tldtools.init(
    function() {
      app.logmessage('TLD:UP');
    },
    function(body) {
      app.logmessage('TLD:Cache fail - ' + body, 'error')
    }
  );

  app.dao.on('ready', function(dao) {
    var server,
      opts = {};

	if (GLOBAL.CFG.server.ssl && GLOBAL.CFG.server.ssl.key && GLOBAL.CFG.server.ssl.cert) {
      app.logmessage('BIPIO:SSL Mode');
      opts.key = fs.readFileSync(GLOBAL.CFG.server.ssl.key);
      opts.cert = fs.readFileSync(GLOBAL.CFG.server.ssl.cert);
    }

    require('./router').init(restapi, dao);

/*
    restapi.use(function(err, req, res, next) {
        var rDomain = domain.create();

        res.on('close', function () {
          rDomain.dispose();
        });

        res.on('finish', function () {
          rDomain.dispose();
        });

        if (err) {
          app.logmessage(err, 'error');
          res.status(500);
          res.send({ error: 'Internal Error' });

          // respawn  worker
          if (!cluster.isMaster) {
            var killtimer = setTimeout(function() {
              app.logmessage('Worker:' + cluster.worker.workerID + ':EXITED');
              process.exit(1);
            }, 5000);

            killtimer.unref();

            app.bastion.close();
            server.close();
            cluster.worker.disconnect();
          }

          rDomain.dispose();

        } else {
          rDomain.run(next);
        }
      });
*/

    if (opts.key) {
      server = https.createServer(opts, restapi);
    } else {
      server = http.createServer(restapi);
    }

    server.listen(GLOBAL.CFG.server.port, GLOBAL.CFG.server.host, function() {
      var rCache = require.cache;
      for (var k in rCache) {
        if (rCache.hasOwnProperty(k) && rCache[k].exports && rCache[k].exports.readme) {
          delete rCache[k].exports.readme;
        }
      }

      app.logmessage('Listening on :' + GLOBAL.CFG.server.port + ' in "' + restapi.settings.env + '" mode...');
    });

  });
}
