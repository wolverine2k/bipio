/**
 *
 * The Bipio API Server.  Application Bootstrap
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

var path = require('path'),
  getopt = require('posix-getopt'),
  option,
  parser = new getopt.BasicParser('f:(forks)', process.argv);

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || path.resolve(__dirname + '/../config');
process.env.MONGOOSE_DISABLE_STABILITY_WARNING = true;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // just for twilio :|

// includes
var app = {
  workerId : ':PID:' + process.pid
},
//sugar       = require('sugar'),
util        = require('util'),
underscore  = require('underscore'),
winston     = require('winston'),
helper      = require('./lib/helper'),
defs        = require('../config/defs'),
envConfig   = require('config'),
cluster     = require('cluster'),
os          = require('os'),
Q           = require('q'),
moment      = require('moment-timezone'),
ipaddr = require('ipaddr.js');
// heapdump = require('heapdump');

require('ssl-root-cas/latest').inject();

// globals
GLOBAL.app = app;
GLOBAL.CFG = envConfig;
GLOBAL.DEFS = defs;
GLOBAL.SERVER_ROOT = path.resolve(__dirname);

while ((option = parser.getopt()) !== undefined) {
  switch (option.option) {
    case 'f' :
      GLOBAL.CFG.server.forks = parseInt(option.optarg);
      break;
  }
}

// attach general helpers to the app
app.helper = helper;
app._ = underscore;
app.Q = Q;
app.moment = moment;

app.isMaster = cluster.isMaster && !process.env.WORKER;

app.modules = {};

app.winston = winston;

app.getConfig = function() {
  return envConfig;
}

// load modules
var mod, ModProto;
for (k in envConfig.modules) {
  if (envConfig.modules.hasOwnProperty(k)) {
    mod =  envConfig.modules[k];

    // pass through server environments
    if (mod.config) {
      mod.config.basePath = GLOBAL.SERVER_ROOT;
    }

    ModProto = require(
      GLOBAL.SERVER_ROOT
      + '/modules/'
      + k
      + '/'
      + mod.strategy
      + '.js'
      );
    app.modules[k] = new ModProto(mod.config);
  }
}

if (process.env.BIP_DUMP_HEAPS) {
  memwatch.on('leak', function(info) {
    app.logmessage(info, 'error');
    var f = '/tmp/bipio_' + process.pid + '_' + Date.now() + '.heapsnapshot';
    console.log('Writing Heap Snapshot ' + f);
    heapdump.writeSnapshot(f);
  });
}

//Configure Winston Log Files
winston.loggers.add('transactionLogs', {
  transports: [
    new (winston.transports.DailyRotateFile)(
    {
      name: 'server_transaction',
      filename: 'logs/w_transaction.log',
      timestamp: true,
      level: 'info',
      tailable: true,
      prettyPrint: true,
      humanReadableUnhandledException: true,
      zippedArchive: true,
      datePattern: '.dd-MM-yyyy'})
    ]
  }
);

winston.loggers.add('serverLogs',{
  transports: [
    new (winston.transports.DailyRotateFile)(
      {
      name: "server_info",
      filename: 'logs/w_server.log',
      timestamp: true,
      tailable: true,
      prettyPrint: true,
      humanReadableUnhandledException: true,
      zippedArchive: true,
      datePattern: '.dd-MM-yyyy'}
    ),
    new (winston.transports.DailyRotateFile)(
      {
      name: "server_error",
      filename: 'logs/w_error.log',
      level: 'error',
      timestamp: true,
      handleExceptions: true,
      tailable: true,
      prettyPrint: true,
      humanReadableUnhandledException: true,
      zippedArchive: true,
      datePattern: '.dd-MM-yyyy'}
    )
  ]
});

var transactionLogger = winston.loggers.get('transactionLogs');
transactionLogger.exitOnError = false;

var serverLogger =  winston.loggers.get('serverLogs');
serverLogger.exitOnError = false;

// setup loglevel filter from server config
var logLevels = [
  'error',
  'warning',
  'info'
];

var allowedLogLevels = {};
for (var i = 0; i < logLevels.length; i++) {
  allowedLogLevels[logLevels[i]] = true;
  if (GLOBAL.CFG.server.logLevel == logLevels[i]) {
    break;
  }
}

// default logger: keep it for now and call winston logger from it
app.logmessage = function(message, loglevel, skip) {
  loglevel = loglevel || 'info';

  if (allowedLogLevels[loglevel]) {

    if(!skip) //To skip winston on recursive calls of app.logmessage
      app.winstonLog(message, loglevel)

     if ('error' === loglevel) {
      console.trace(message);
    }

    var obj = helper.isObject(message);
    if (!obj) {
      if (message && message.trim) {
        message = message.trim();
      }

      if (!message) {
        return;
      }
      message = (app.workerId ? 'WORKER' + app.workerId : process.pid ) + ':' + (new Date()).getTime() + ':' + message;
    } else {
      app.logmessage((app.workerId ? 'WORKER' + app.workerId : process.pid ) + ':' + (new Date()).getTime() + ':OBJECT', loglevel, true);
    }

    if ('error' === loglevel) {
     console.trace(message);
    } else {
      console.log(message);
    }
  }
}

// winston logger
app.winstonLog = function(message, loglevel) {
	if(!loglevel) {
		loglevel = "info";
	}
  var meta = (app.workerId ? { WORKER:  (app.workerId).replace(':PID:', 'PID:') } : { WORKER: (process.pid).replace(':PID:', 'PID:')});
  if ('error' === loglevel) {
    var err = new Error(message);
    meta["stack"]  = err.stack;
  }
  var obj = helper.isObject(message);
  if (!obj) {
     if (message && message.trim) {
       message = message.trim();
     }
     if (!message) {
       return;
     }
   } else {
    message = "Check Message";
    meta["message"] = message;
  }

  serverLogger.log(loglevel, message, meta);

  if( typeof message === 'string' && -1 !== message.toLowerCase().indexOf('bastion')) {
    transactionLogger.log(loglevel, message, meta);
  }

  delete message;
  delete loglevel;
}

// exception catchall

process.addListener('uncaughtException', function (err, stack) {
  var message = 'Caught exception: ' + err + '\n' + err.stack;
  if (app && app.logmessage) {
    app.logmessage(message, 'error', true); //true to skip winstonLog in logMessage, as it is a stack
    app.winstonLog(err.message, 'error'); //Call winston logger directly
  } else {
    console.trace(message);
  }

  // if binding error, then drop the process
  if ('EADDRINUSE' === err.code) {
    console.error('Shutting Down...');
    process.exit(1);
  }

});

if (!GLOBAL.CFG.server.public_interfaces && !process.HEADLESS) {
  GLOBAL.CFG.server.public_interfaces = [];
  var ifaces = os.networkInterfaces();
  for (var i in ifaces) {
    ifaces[i].forEach(function(details) {
      app.logmessage('Resolvable Interface ' + i + ':' + details.address);
      GLOBAL.CFG.server.public_interfaces.push(details.address);
    });
  }
}

// validate config
if (/^http(s?):\/\//i.test(envConfig.domain_public)) {
  envConfig.domain_public = envConfig.domain_public.replace(/^http(s?):\/\//, '');
  app.logmessage('CONFIG:domain_public should not include protocol', 'warn');
}

var domainPublic = envConfig.domain_public.replace(/:\d*/, '');
if (ipaddr.IPv4.isValid(domainPublic) || ipaddr.IPv6.isValid(domainPublic) ) {
  app.logmessage('CONFIG:domain_public can not be an IP Address', 'error');
  process.exit(0);
}

// initialize DAO and bastion (queue manager)
var dao = new require('./lib/dao'),
bastion = new require('./lib/bastion');

module.exports.app = app;
module.exports.app.dao = new dao(CFG, app.logmessage);
module.exports.app.bastion = new bastion(module.exports.app.dao, process.HEADLESS || process.env.NOCONSUME);

// bind dao to modules
for (var k in app.modules) {

  if (app.modules.hasOwnProperty(k) && app.modules[k].setApp) {
    app.modules[k].setApp(module.exports.app);
  }

  if (app.modules.hasOwnProperty(k) && app.modules[k].setDAO) {
    app.modules[k].setDAO(module.exports.app.dao);
  }

  if (app.modules.hasOwnProperty(k) && app.modules[k].initialize) {
    app.modules[k].initialize(app);
  }
}
