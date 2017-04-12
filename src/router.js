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

/**
 *
 * ExpressJS REST API front-end routing wrapper
 *
 */
app = module.parent.exports.app;

var dao,
  bastion,
  util    = require('util'),
  express = require('express'),
  connect = require('connect'),
  helper  = require('./lib/helper'),
  uuid    = require('node-uuid'),
  pkg = require('../package.json'),
  // restful models
  restResources = [ 'bip', 'channel', 'domain', 'account_option' ];

/**
 * Wrapper for connect.basicAuth. Checks the session for an authed flag and
 * if fails, defers to http basic auth.
 */
function restAuthWrapper(req, res, next) {
  if (!req.header('authorization') && req.session.account && req.session.account.host === getClientInfo(req).host && !req.masqUser) {
    app.modules.auth.getAccountStruct(req.session.account, function(err, accountInfo) {
      if (!err) {
        req.remoteUser = req.user = accountInfo;
        next();
      } else {
        res.status(401).end();
      }
    });
  } else {
    return connect.basicAuth(function(user, pass, next) {
      app.modules.auth.test(user, pass, { masquerade : req.masqUser }, next);
    })(req, res, next);
  }
}

/**
 * Normalizes response data, catches errors etc.
 */
var restResponse = function(res) {
  return function(error, modelName, results, code, options) {
    var contentType = DEFS.CONTENTTYPE_JSON;
    if (options) {
      if (options.content_type) {
        contentType = options.content_type;
      }
    }

    res.contentType(contentType);

    if (error) {
      if (!code) {
        code = 500;
        app.logmessage('Error response propogated without code', 'warning');
      }

      res.status(code).send({ message : error.toString() });
      return;
    } else {

      if (!results) {
        res.status(404).end();
        return;
      }
    }

    /**
     * Post filter. Don't expose attributes that aren't in the public filter
     * list.
     */
    if (modelName) {
      dao.filterModel('read', modelName, results);
    }

    // results should contain a '_redirect' url
    if (code == 301) {
      res.redirect(results._redirect);
      return;
    }
    if (contentType == DEFS.CONTENTTYPE_JSON) {
      res.status(!code ? '200' : code).jsonp(results);
    } else {
      res.status(!code ? '200' : code).send(results);
    }
    return;
  }
}

function getReferer(req) {
  referer = req.query.referer;
  if (undefined == referer) {
    referer = req.header('Referer');
  }

  if (undefined == referer) {
    return null;
  } else {
    return helper.getDomainTokens(referer);
  }
}

function getClientInfo(req, txId) {
  var host;

  if (req.header('X-Forwarded-For')) {
    host = req.header('X-Forwarded-For').split(',').shift().trim();
  } else {
    host = req.connection.remoteAddress;
  }

  return {
    'id' : txId || uuid.v4(),
    'host' : host,
    'date' : Math.floor(new Date().getTime() / 1000),
    'proto' : 'http',
    'reply_to' : '',
    'method' : req.method,
    'content_type' : helper.getMime(req),
    'encoding' : req.encoding,
    'headers' : req.headers
  };
}

/**
 * Generic RESTful handler for restResources
 */
var restAction = function(req, res) {
  var rMethod = req.method,
  accountInfo = req.remoteUser,
  owner_id = accountInfo.getId(),
  resourceName = req.params.resource_name,
  resourceId = req.params.id,
  subResourceId = req.params.subresource_id,
  postSave;

  // User is authenticated and the requested model is marked as restful?
  if (undefined != owner_id && helper.indexOf(restResources, resourceName) != -1) {

    if (rMethod == 'POST' || rMethod == 'PUT') {
      // hack for bips, inject a referer note if no note has been sent
      if (resourceName == 'bip') {
        var referer = getReferer(req);

        if (null != referer) {
          if (undefined == req.body.note) {
            req.body.note = 'via ' + referer.url_tokens.hostname;
          }

          // inject the referer favico
          if (undefined == req.body.icon
              && -1 === referer.url_tokens.hostname.indexOf(CFG.domain.replace(/:\d*$/, ''))
              && -1 === referer.url_tokens.hostname.indexOf(CFG.domain_public.replace(/:\d*$/, ''))
              ) {
            postSave = function(err, modelName, retModel, code ) {
              if (!err && retModel.icon == '') {
                app.helper.syncFavicon(referer.url_tokens.href, function(err, icoURL) {
                  if (!err) {
                    dao.updateColumn('bip', retModel.id, {
                      icon : icoURL
                    });
                  }
                });
              }
            }
          }
        }
      }

      var model;

      if (rMethod == 'POST') {
        // populate our model with the request.  Set an owner_id to be the
        // authenticated user before doing anything else
        model = dao.modelFactory(resourceName, helper.pasteurize(req.body), accountInfo, true);
        dao.create(model, restResponse(res), accountInfo, postSave);
      } else if (rMethod == 'PUT') {
        dao.filterModel('write', resourceName, req.body);

        if (undefined != req.params.id) {
          dao.update(
            resourceName,
            req.params.id,
            req.body,
            restResponse(res),
            accountInfo
            );
        } else {
          res.status(404).end();
        }
      }
    } else if (rMethod == 'DELETE') {

      if ('bip' === resourceName && 'logs' === subResourceId) {
        dao.removeFilter('bip_log', { bip_id : req.params.id }, restResponse(res));

      } else if (undefined != req.params.id) {
        dao.remove(resourceName, req.params.id, accountInfo, restResponse(res));
      } else {
        res.status(404).end();
      }
    } else if (rMethod == 'PATCH') {
      if (undefined != req.params.id) {

        dao.filterModel('write', resourceName, req.body);

        dao.patch(
          resourceName,
          req.params.id,
          req.body,
          accountInfo,
          restResponse(res)
          );
      } else {
        res.status(404).end();
      }
    } else if (rMethod == 'GET') {
      var filter = {};

      // handle sub-collections
      if ('bip' === resourceName && 'logs' === subResourceId) {
        filter.bip_id = req.params.id;
        resourceName = 'bip_log';
        req.params.id = undefined;

      } else if ('channel' === resourceName && 'bips' === subResourceId) {
        filter._channel_idx = resourceId;
        resourceName = 'bip';
        req.params.id = undefined;

      } else if ('channel' === resourceName && 'logs' === subResourceId) {
        filter.channel_id = req.params.id;
        resourceName = 'channel_log';
        req.params.id = undefined;
      }

      if (undefined !== req.params.id) {
          var model = dao.modelFactory(resourceName, {}, accountInfo);
          dao.get(model, req.params.id, accountInfo, restResponse(res));

      } else {
        var page_size = 10,
        page = 1,
        order_by = 'recent';

        if (undefined != req.query.page_size && req.query.page_size) {
          page_size = parseInt(req.query.page_size);
        }

        if (undefined != req.query.page) {
          page = parseInt(req.query.page);
        }

        if (undefined != req.query.order_by &&
          (req.query.order_by == 'recent' ||
            req.query.order_by == 'active' ||
            req.query.order_by == 'alphabetical')
          ) {
          order_by = req.query.order_by;
        }

        // extract filters
        if (undefined != req.query.filter) {
          var tokens = req.query.filter.split(',');
          for (i in tokens) {
            var filterVars = tokens[i].split(':');
            if (undefined != filterVars[0] && undefined != filterVars[1]) {
              filter[filterVars[0]] = filterVars[1];
            }
          }
        }

        dao.list(resourceName, accountInfo, page_size, page, order_by, filter, restResponse(res));
      }
    }
  } else {
    res.status(404).end();
  }
  return;
}

function callRenderer(ownerId, renderer, req, res) {
  if (renderer && renderer.channel_id) {
    var filter = {
      owner_id: ownerId,
      id : renderer.channel_id
    };

    dao.find('channel', filter, function(err, result) {
      if (err || !result) {
        res.status(404).end();
      } else {
        dao.modelFactory('channel', result).rpc(
          renderer.renderer,
          req.query,
          getClientInfo(req),
          req,
          res
          );
      }
    });
  } else if (renderer && renderer.pod) {
    var channel = dao.modelFactory('channel', {
      owner_id : ownerId,
      action :renderer.pod + '.'
    });

    channel.rpc(
      renderer.renderer,
      req.query,
      getClientInfo(req),
      req,
      res
    );

  } else {
    res.status(404).end();
  }
}

// ---------------- BIP RPC --------------------------------------------------------

function bipBasicFail(req, res) {
  connect.basicAuth(function(username, password, cb){
    cb(false, false);
  })(req, res);
}

/*
 * Authenticate the bip before we pass it through.  If there's no bip found,
 * the bip has auth = token or the domain doesn't exist, then fall through
 * to an account level auth (although the account auth for nx domain
 * shouldn't ever succeed).
 *
 * We don't want to let people interrogate whether or not a HTTP exists based
 * on the auth response (or non-response).  Therefore, always prompt for
 * HTTP auth on this endpoint unless the bip is explicitly 'none'
 */
function bipAuthWrapper(req, res, cb) {
  app.modules.auth.domainAuth(helper.getDomain(req.headers.host, true), function(err, acctResult) {
    if (err) {
      // reject always
      bipBasicFail(req, res);
    } else {
      filter = {
        'name' : req.params.bip_name,
        'type' : 'http',
        'paused' : false,
        'domain_id' : acctResult.getActiveDomain().id
      };

      dao.find('bip', filter, function(err, result) {
        if (!err && result) {
          if (result.config.auth == 'none') {
            req.remoteUser = acctResult;

            cb(false, true);

          } else {
            connect.basicAuth(function(username, password, next) {
              if ('basic' === result.config.auth) {
                var authed = result.config.username
                  && result.config.username == username
                  && result.config.password
                  && result.config.password == password;

                if (authed) {
                  app.modules.auth.test(result.owner_id, password, { acctBind : true, asOwner : true, masquerade : req.masqUser }, next);
                } else {
                  bipBasicFail(req, res);
                }

              } else if ('token' === result.config.auth) {
                app.modules.auth.test(username, password, { masquerade : req.masqUser }, next);
              } else {
                bipBasicFail(req, res);
              }
            })(req, res, cb);
          }
        } else {
          bipBasicFail(req, res);
        }
      });
    }
  });
}

module.exports = {
  init : function(express, _dao) {
    dao = _dao;

    // attach any modules which are route aware
    for (var k in app.modules) {
      if (app.modules.hasOwnProperty(k) && app.modules[k].routes) {
        app.modules[k].routes(express, restAuthWrapper, app);
      }
    }

    express.post( '/rest/:resource_name', restAuthWrapper, restAction);
    express.get( '/rest/:resource_name/:id?', restAuthWrapper, restAction);
    express.get( '/rest/:resource_name/:id?/:subresource_id?', restAuthWrapper, restAction);
    express.put( '/rest/:resource_name/:id?', restAuthWrapper, restAction);
    express.delete( '/rest/:resource_name/:id/:subresource_id?', restAuthWrapper, restAction);
    express.patch( '/rest/:resource_name/:id', restAuthWrapper, restAction);
    express.options('*', function(req, res) {
      res.status(200).end();
    });

    /**
     * Pass through HTTP Bips
     */
    express.all('/bip/http/:bip_name', bipAuthWrapper, function(req, res) {
      var txId = uuid.v4(),
      client = getClientInfo(req, txId),
      files = [],
      contentParts = {},
      contentType = helper.getMime(req),
      encoding = req.encoding,
      statusMap = {
        'success' : 200,
        'fail' : 404
      },
      bipName = req.params.bip_name,
      domain = helper.getDomain(req.headers.host, true);

      _.each(req.files, function(file) {
        files.push(file);
      });

      GLOBAL.app.bastion.bipUnpack(
        'http',
        bipName,
        req.remoteUser,
        client,
        function(err, bip) {
          var exports = {
            'source' : {}
          };

          // setup source exports for this bip
          if (bip && bip.config.exports && bip.config.exports.length > 0) {
            var exportLen = bip.config.exports.length,
            key;

            for (var i = 0; i < exportLen; i++) {
              key = bip.config.exports[i];
              if (req.query[key]) {
                exports.source[key] = req.query[key];
              }
            }
          } else {

            exports.source = ('GET' === req.method) ? req.query : req.body;

            exports.source.rawBody = req.rawBody;
          }

          var restReponse = true;
          // forward to bastion
          if (!err) {
            exports._client = client;
            exports._bip = bip;

            // Renderer Invoke, send a repsonse
            if (bip.config.renderer) {
              // get channel
              callRenderer(
                bip.owner_id,
                bip.config.renderer,
                req,
                res
              );

              restReponse = false;
            }

            GLOBAL.app.bastion.bipFire(bip, exports, client, contentParts, files);
          }

          if (restReponse) {
            var bipResp = { status : 'OK' };
            if (err) {
              bipResp.status = 'ERROR';
              bipResp.message = err;
            }
            restResponse(res)( err, undefined, bipResp, err ? 404 : 200);
          }
        });

    });

  /*
    OEmbed widget API.
  */

  express.get('/rpc/oembed/*', function(req, res) {
    if (req.query.url && GLOBAL.CFG.oembed_host) {

      var shareId = req.query.url.split('/')[req.query.url.split('/').length - 1]

      dao.find('bip_share', { id : shareId }, function(err, result) {

        if (err) {
          res.status(500).json(err)
        }

        res.json({
          version: "1.0",
          type: "rich",
          provider_name: "Bipio",
          provider_url: GLOBAL.CFG.website_public,
          width: "470",
          height: "94",
          html: "<iframe src=\""+ GLOBAL.CFG.oembed_host + "/widget/?payload=" + new Buffer(JSON.stringify(result)).toString("base64") +"\" allowtransparency=\"true\" style=\"border: none; overflow: hidden;\" width=\"470\" height=\"94\"></iframe>"
        });
      });

    }
    else {
      res.status(404).end();
    }
  });

	express.get('/rpc/transforms', function(req, res) {
		dao.list('transform_default', undefined, 100, 1, 'recent', {owner_id : 'system'}, function(err, modelName, results) {
			res.json(results);
		});
	});

  express.get('/rpc/describe/:model/:model_subdomain?', restAuthWrapper, function(req, res) {
    var model = req.params.model,
    model_subdomain = req.params.model_subdomain;
    res.contentType(DEFS.CONTENTTYPE_JSON);

    dao.describe(model, model_subdomain, restResponse(res), req.remoteUser);
  });

  /**
   * DomainAuth channel renderer
   * @deprecated /rpc/render/channel/:channel_id/:renderer
   */
  express.get('/rpc/render/channel/:channel_id/:renderer', restAuthWrapper, function(req, res) {
      var filter = {
        owner_id: req.remoteUser.getId(),
        id : req.params.channel_id
      };

      dao.find('channel', filter, function(err, result) {
        if (err || !result) {
          app.logmessage(err, 'error');
          res.status(404).end();
        } else {
          var channel = dao.modelFactory('channel', result, req.remoteUser);

          channel.rpc(
            req.params.renderer,
            req.query,
            getClientInfo(req),
            req,
            res
            );
        }
      });
  });

  express.get('/rpc/channel/:channel_id/:renderer/:extra_params?/:extra_params_value?', restAuthWrapper, function(req, res) {
      var filter = {
        owner_id: req.remoteUser.getId(),
        id : req.params.channel_id
      };

      dao.find('channel', filter, function(err, result) {
        var ok = false;

        if (!err ) {
          if (!result) {
            if (!app.helper.regUUID.test(req.params.channel_id)) {
              var tokens = req.params.channel_id.split('.'),
                pod = dao.pod(tokens[0]),
                action;

              if (pod && pod.getAction(tokens[1])) {
                // check for RPC name and required fields
                action = pod.getAction(tokens[1]);
                if (action && action.rpcs && action.rpcs[req.params.renderer]) {

                  if (action.rpcs[req.params.renderer].required
                    && action.rpcs[req.params.renderer].required.length
                    && _.difference(
                      action.rpcs[req.params.renderer].required,
                      Object.keys(req.query)).length
                  ) {
                    res.status(400).send({ message : 'Missing Required Fields'});
                    return;
                  }
                  ok = true;

                } else if ('invoke' === req.params.renderer) {

                  ok = true;
                }

                if (ok) {
                  result = {
                    'id' : req.params.channel_id,
                    'action' : tokens[0] + '.' + tokens[1],
                    'owner_id' : req.remoteUser.getId(),
                    'config' : {}
                  };
                }

              }
            }
          } else {
            ok = true;
          }
        }

        if (ok) {
          var channel = dao.modelFactory('channel', result, req.remoteUser);

          channel.rpc(
            req.params.renderer,
            req.query,
            getClientInfo(req),
            req,
            res
          );

        } else {
          if (err) {
            app.logmessage(err, 'error');
          }

          res.status(404).end();
          return;
        }

      });
  });

    /**
     * Account Auth RPC, sets up oAuth for the selected pod, if the pod supports oAuth
     */
    express.all('/rpc/oauth/:pod/:auth_method', restAuthWrapper, function(req, res) {
      var podName = req.params.pod,
      pod = dao.pod(podName),
      method = req.params.auth_method;

      // check that authentication is supported/required by this pod
      if (pod) {
        if (!pod.oAuthRPC(method, req, res)) {
          res.status(415).end();
        }
      } else {
        res.status(404).end();
      }
    });

    /**
     * Account Auth RPC, sets up issuer_token (API keypair) for the selected pod, if the pod supports issuer_token
     */
    express.all('/rpc/issuer_token/:pod/:auth_method', restAuthWrapper, function(req, res) {
      var podName = req.params.pod,
      pod = dao.pod(podName),
      method = req.params.auth_method;

      // check that authentication is supported/required by this pod
      if (!pod.issuerTokenRPC(method, req, res)) {
        res.status(415).end();
      }
    });

    express.all('/rpc/pod/:pod/render/:method/:arg?', restAuthWrapper, function(req, res) {
      (function(req, res) {
        var method = req.params.method
        accountInfo = req.remoteUser,
        channel = dao.modelFactory('channel', {
          owner_id : accountInfo.getId(),
          action : req.params.pod + '.'
        }),
        pod = channel.getPods(req.params.pod, accountInfo);

        if (pod && method) {
          req.remoteUser = accountInfo;

          if (req.params.arg) {
            req.query._requestArg = req.params.arg;
          }

          channel.rpc(
            method,
            req.query,
            getClientInfo(req),
            req,
            res
          );

        } else {
          res.status(404).end();
        }
      })(req, res);
    });

    express.all('/rpc/render/pod/:pod/:method/:arg?', restAuthWrapper, function(req, res) {
      (function(req, res) {
        var method = req.params.method
        accountInfo = req.remoteUser,
        channel = dao.modelFactory('channel', {
          owner_id : accountInfo.getId(),
          action : req.params.pod + '.'
        }),
        pod = channel.getPods(req.params.pod);

        if (pod && method) {
          req.remoteUser = accountInfo;

          if (req.params.arg) {
            req.query._requestArg = req.params.arg;
          }

          channel.rpc(
            method,
            req.query,
            getClientInfo(req),
            req,
            res
            );

        } else {
          res.status(404).end();
        }
      })(req, res);
    });

    /**
      * Pass through an RPC call to a pod
      */
    express.all('/rpc/pod/:pod/:action/:method/:channel_id?', restAuthWrapper, function(req, res) {
      (function(req, res) {
        var pod = dao.pod(req.params.pod);
        action = req.params.action,
        method = req.params.method,
        cid = req.params.channel_id,
        accountInfo = req.remoteUser;

        if (pod && action && method) {
          req.remoteUser = accountInfo;

          if (cid) {
            var filter = {
              owner_id: accountInfo.id,
              id : cid
            };

            dao.find('channel', filter, function(err, result) {
              if (err || !result) {
                app.logmessage(err, 'error');
                res.status(404).end();
              } else {
                var channel = dao.modelFactory('channel', result),
                  pod = channel.getPod();

                pod.rpc(podTokens.action, method, req, restResponse(res), channel);
              }
            });
          } else {
            var channel = dao.modelFactory('channel', {
              owner_id : accountInfo.getId(),
              action : pod.getName() + '.' + action
            });

            channel.rpc(
              method,
              req.query,
              getClientInfo(req),
              req,
              res
              );
          }
        } else {
          res.status(404).end();
        }
      })(req, res);
    });

    express.post('/rpc/:method_domain?/:method_name?/:resource_id?/:subresource_id?', restAuthWrapper, function(req, res) {
      res.contentType(DEFS.CONTENTTYPE_JSON);

      var response = {};
      var methodDomain = req.params.method_domain;
      var method = req.params.method_name;
      var resourceId = req.params.resource_id;
      var subResourceId = req.params.subresource_id;
      var accountInfo = req.remoteUser;

      if (methodDomain == 'bip') {
        if (method == 'share') {
          var filter = {
            'owner_id' : accountInfo.getId(),
            'id' : resourceId
          }

          var shareModel = helper.pasteurize(req.body);

          shareModel.bip_id = shareModel.id;

          dao.shareBip(dao.modelFactory('bip_share', shareModel, accountInfo, true), null, restResponse(res));
        }
      }
    });

    // ----------------------------------------------------------- CATCHALLS

    // RPC Catchall
    express.get('/rpc/:method_domain?/:method_name?/:resource_id?/:subresource_id?', restAuthWrapper, function(req, res) {

      res.contentType(DEFS.CONTENTTYPE_JSON);
      var response = {};
      var methodDomain = req.params.method_domain;
      var method = req.params.method_name;
      var resourceId = req.params.resource_id;
      var subResourceId = req.params.subresource_id;
      var accountInfo = req.remoteUser;

      if (methodDomain == 'get_referer_hint') {
        referer = req.query.referer;
        if (undefined == referer) {
          referer = req.header('Referer');
        }

        if (undefined == referer) {
          response = 400;
        } else {
          result = helper.getDomainTokens(referer);
          response.hint = (result.url_tokens.auth ? result.url_tokens.auth + '_' : '') + result.domain;
          response.referer = referer;
          response.scheme = result.url_tokens.protocol.replace(':', '');
        }
        res.send(response);


      // attempts to create a bip from the referer using default settings.
      } else if (methodDomain == 'bip') {
        if (method == 'create_from_referer') {
          result = getReferer(req);
          if (undefined == result) {
            response = 400;
            res.send(response);
          } else {
            // inject the bip POST handler
            req.method = 'POST';
            req.params.resource_name = 'bip';
            req.body = {
              'name' : (result.url_tokens.auth ? result.url_tokens.auth + '_' : '') + result.domain,
              'note' : 'via ' + result.url_tokens.hostname
            }
            restAction(req, res);
          }
        } else if (method == 'get_transform_hint') {
          var from = req.query.from,
          to = req.query.to;

          if (from && to) {
            dao.getTransformHint(accountInfo, from, to, restResponse(res));
          } else {
            response = 400;
            res.send(response);
          }
        } else if (method == 'share' && resourceId) {

          if (resourceId === 'list') {
            var page_size = 10,
            page = 1,
            order_by = 'recent',
            filter = {};

            if (undefined != req.query.page_size) {
              page_size = parseInt(req.query.page_size);
            }

            if (undefined != req.query.page) {
              page = parseInt(req.query.page);
            }

            dao.listShares(page, page_size, order_by, req.query.filter, restResponse(res));
          } else {
            if (subResourceId && 'test' === subResourceId) {
              var filter = {
                'owner_id' : accountInfo.getId(),
                'bip_id' : resourceId
              }

              dao.find('bip_share', filter, function(err, result) {
                if (err || !result) {
                  res.status(404).end();
                } else {
                  res.status(200).end();
                }
              });

            } else if (resourceId == 'inc' && subResourceId) {
              var accountInfo = req.remoteUser;
              dao.incShareCount(subResourceId, accountInfo);
              restResponse(res)(false, null, {"status" : "ok"});
            } else {
              var filter = {
                'owner_id' : accountInfo.getId(),
                'id' : resourceId
              }

              dao.find('bip', filter, function(err, result) {
                if (err || !result) {
                  app.logmessage(err, 'error');
                  res.status(404).end();
                } else {
                  var triggerConfig = req.query.triggerConfig;
                  if (triggerConfig) {
                    try {
                      triggerConfig = app.helper.pasteurize(JSON.parse(triggerConfig));
                    } catch (e) {
                      triggerConfig = {};
                      app.logmessage(e, 'error')
                    }
                  }
                  dao.shareBip(dao.modelFactory('bip', result, accountInfo, true), triggerConfig, restResponse(res));
                }
              });
            }
          }
        } else if (method == 'unshare' && resourceId) {

          dao.unshareBip(resourceId, accountInfo, restResponse(res));

        // alias into account options.  Returns RESTful account_options resource
        } else if (method == 'set_default' && resourceId) {
          var accountInfo = req.remoteUser,
          filter = {
            'owner_id' : accountInfo.getId()
          };

          dao.find('account_option', filter, function(err, result) {
            if (err || !result) {
              res.status(404).end();
            } else {
              dao.setDefaultBip(
                resourceId,
                dao.modelFactory('account_option', result, accountInfo),
                accountInfo,
                restResponse(res)
              );
            }
          });

        } else if (method == 'trigger' && resourceId) {
          var filter = {
            id : resourceId,
            owner_id : accountInfo.getId(),
            type : 'trigger'
          }

          var respond = restResponse(res);

          dao.find('bip', filter, function(err, result) {
            if (err) {
              respond.apply(this, arguments);
            } else if (!result) {
              respond(false, 'bip');
            } else {
              dao.triggerAll(
                function(err) {
                  if (err) {
                    respond('Internal Server Error', 'bip', null, 500);
                  } else {
                    respond(false, 'bip', { message : 'OK'});
                  }
                },
                {
                  id : result.id
                },
                false,
                true
              );
            }
          });

        } else {
          res.status(400).end();
        }
      } else if (methodDomain == 'domain') {
        // confirms a domain has been properly configured.  If currently
        // set as !_available, then enables it.
        if (method == 'confirm') {
          var accountInfo = req.remoteUser;
          var filter = {
            'owner_id' : accountInfo.getId(),
            'id' : resourceId
          }

          dao.find('domain', filter, function(err, result) {
            if (err || !result) {
              res.status(404).end();
            } else {
              var domain = dao.modelFactory('domain', result, accountInfo, true);
              domain.verify(accountInfo, restResponse(res));
            }
          });

        } else {
          res.send(response);
        }
      } else {
        res.status(400).end();
      }
    });

    express.get('/login', function(req, res) {
      var authorization = req.headers.authorization;

      if (!authorization) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Authorization Required"');
        res.end('Unauthorized')
        return;
      }

      var parts = authorization.split(' ');

      if (parts.length !== 2) {
        res.status(400).end();
        return;
      }

      var scheme = parts[0]
      , credentials = new Buffer(parts[1], 'base64').toString()
      , index = credentials.indexOf(':');

      if ('Basic' != scheme || index < 0) {
        res.status(400).end();
        return;
      }

      var user = credentials.slice(0, index),
      pass = credentials.slice(index + 1);

      app.modules.auth.test(user, pass, { masquerade : req.masqUser}, function(err, result) {
        if (err) {
          res.status(401).end()
        } else {
          req.session.account = {
            owner_id : result.user.id,
            username : result.user.username,
            name : result.user.name,
            account_level : result.user.account_level,
            host : getClientInfo(req).host
          }

          if (req.session && req.session.account) {
            app.logmessage('LOGIN:' + req.session.account.username);
          }

          result.getSettings(function(err, settings) {
            if (result._remoteBody) {
              result.user.settings['remote_settings'] = result._remoteBody || {};
            }

            dao.filterModel('read', 'account_option', settings);

            res.send(settings);
          });

          // update session
          app.dao.updateColumn(
            'account',
            {
              id : result.user.id
            },
            {
              last_session : helper.nowUTCSeconds() / 1000
            }
          );
        }
      });
    });

    express.get('/logout', function(req, res) {
      if (req.session && req.session.account) {
        app.logmessage('LOGOUT:' + req.session.account.username);
      }

      req.session.destroy();
      res.status(200).end();
    });

	express.get('/status', function(req, res) {
	  var serverStatus = {};

	  // get server version number:
	  serverStatus['version'] = pkg.version;

    	// get rabbitmq connection status
    	if (app.bastion.isRabbitConnected()) {
  			serverStatus['rabbitmq'] = "connected";
  		} else {
  			serverStatus['rabbitmq'] = "error";
  		};

  		// get mongodb connection status
  		if (app.dao.getConnection().readyState) {
  			serverStatus['mongodb'] = "connected";
  		} else {
  			serverStatus['mongodb'] = "error";
  		};

  		res.status(200).send(serverStatus);

  	});

    express.all('*', function(req, res, next) {
      if (req.method == 'OPTIONS') {
        res.status(200).end();

      // API has no default/catchall renderer
      } else if (req.headers.host === CFG.domain_public) {
        next();
      } else {
        // try to find a default renderer for this domain
        app.modules.auth.domainAuth(
          helper.getDomain(req.headers.host, true),
          function(err, accountInfo) {
            if (err) {
              res.status(500).end();
            } else if (!accountInfo) {
              next();
            } else {

              // find default renderer
              var ownerId = accountInfo.getId(),
              domain = accountInfo.getActiveDomain(),
              filter;

              req.remoteUser = accountInfo;

              if (app.helper.isObject(domain.renderer) && domain.renderer.channel_id && '' !== domain.renderer.channel_id) {
                filter = {
                  id : domain.renderer.channel_id,
                  owner_id : ownerId
                }
                dao.find('channel', filter, function(err, result) {
                  if (err) {
                    res.status(500).end();

                  } else if (!result) {
                    res.status(404).end();

                  } else {
                    callRenderer(
                      result.owner_id,
                      {
                        "channel_id" : result.id,
                        "renderer" : domain.renderer.renderer
                      },
                      req,
                      res);
                  }
                });
              } else if (app.helper.isObject(domain.renderer) && domain.renderer.pod && '' !== domain.renderer.pod) {
                callRenderer(
                  ownerId,
                  domain.renderer,
                  req,
                  res);
              } else {
                res.status(404).end();
              }
            }
          });
      }
    });
  }
}
