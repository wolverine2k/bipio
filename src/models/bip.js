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
 var async = require('async'),
   baseConverter = require('base-converter'),
   BipModel = require('./prototype.js').BipModel,
   Bip = Object.create(BipModel),
  //cronParser = require('cron-parser'),
  Rrecur = require('rrecur').Rrecur;

// setters
/**
 *
 */
 function generate_random_base() {
  var ret = '';
  var charRanges = {
    48 : 57,
    65 : 90,
    97 : 122
  }

  for (lower in charRanges) {
    for (var i = lower; i <= charRanges[lower]; i++) {
      ret += String.fromCharCode(i);
    }
  }

  return '.' + ret + '_';
}

  // strict formatting of date string required for scheduler to work
function removeOffset(time) {
  return normedStart = time.substr(0, 16);
}

function setSchedule(schedule) {
  	var sched, recur, recurStr, startTime;

  if (schedule && app.helper.isObject(schedule) && Object.keys(schedule)) {
  	recurStr = schedule.recurrencePattern;

    if (!schedule.startDateTime.trim()) {
      schedule.startDateTime = app.moment().format();
    }

  	// FuelBox UI tacks on trailing semicolon, which breaks ability for rrecurjs to create() an iterable object.
  	recurStr = (recurStr.charAt(recurStr.length-1) == ';') ? recurStr.slice(0,-1) : recurStr;

    startTime = removeOffset(schedule.startDateTime);

    sched = {
      dtstart: {
       zoneless: startTime,
       locale: schedule.timeZone.offset
      },
      rrule: Rrecur.parse(recurStr)
     };

    schedule['sched'] = sched;

    recur = Rrecur.create(sched, schedule.startTime, schedule.timeZone.offset);
    schedule['nextTimeToRun'] = moment(recur.next()).unix() * 1000;

    return schedule;
  }
}

/**
 * Takes a time string
 *
 * Doesn't make a user setting timezone translation here, if they change timezones
 * it means system needs to update all of their bips.
 */
 function endLifeParse(end_life) {
  var seconds, d;

  // passed validation but isn't a number, then set it zero (never end based on impressions)
  if (isNaN(parseInt(end_life.imp))) {
    end_life.imp = 0;
  }

  if (!end_life.time) {
    end_life.time = 0;
  } else if (end_life.time !== '0' && end_life.time !== 0 && end_life.time !== '') {
    try {
      d = new Date(Date.parse(end_life.time));
      if (d.getTime() != 0) {
        end_life.time = Math.floor(d.getTime() / 1000);
      }
    } catch (e) {
    }
  }

  return end_life;
}

function escapeDot(val) {
  return val.replace(/\./g, '\u0001');
}

function unEscapeDot(val) {
  return val.replace(/\u0001/g, '.');
}

// -----------------------------------------------------------------------------
Bip.repr = function(accountInfo, next) {
  var self = this,
    repr = '',
    domains = accountInfo.getDomains(),
    domain,
    domainName;

  if (!domains) {
    repr = this.name;

  } else if (this.domain_id) {

    domain = _.findWhere(domains, { id : this.domain_id});

    if (app.helper.isArray(domain)) {
      domain = array_pop(domain);
    }

    domain = this._dao.modelFactory('domain', domain);

    domainName = domain.repr();

    // inject the port for dev
    if (process.env.NODE_ENV == 'development') {
      domainName += ':' + CFG.server.port;
    }

    if (self.type === 'http') {
      repr = (CFG.proto_user ? CFG.proto_user : CFG.proto_public) + domainName + '/bip/http/' + this.name;

    } else if (this.type == 'smtp') {
      repr = self.name + '@' + domainName;
    }
  }

  return repr;
}

Bip.links = function(accountInfo) {
  var links = [];
  if (this.type === 'http') {
    var schema = {
      'href' : this.repr(accountInfo),
      'rel' : '_repr',
      'encType' : 'application/json',
      "schema" : {
        "properties" : {
        },
        "required" : []
      }
    };

    if (this.exports) {
      schema.schema = this.exports;
    }

    for (var sCID in this.hub) {
      if (this.hub.hasOwnProperty(sCID) && this.hub[sCID].transforms) {
        for (var eCID in this.hub[sCID].transforms) {
          if (this.hub[sCID].transforms.hasOwnProperty(eCID)) {
            for (var attr in this.hub[sCID].transforms[eCID]) {
              var tokens = this.hub[sCID].transforms[eCID][attr].match(app.helper.regActionSource),
              key;

              if (tokens) {
                for (var i = 0; i < tokens.length; i++ ) {
                  key = tokens[i].replace(app.helper.regActionSource, '$3');

                  if (key && schema.schema.type === 'object' && !schema.schema.properties[key]) {
                    schema.schema.properties[key] = {
                      type : "string",
                      name : key
                    };

                    if (!schema.schema.required) {
                      schema.schema.required = [];
                    }

                    schema.schema.required.push(key);
                  }
                }
              }
            }
          }
        }

      }
    }

    // traverse transforms, extract attributes
    links.push(schema);
  }

  if (this._errors) {
    links.push({
      _href : this._dao.getBaseUrl() + '/rest/bip/' + this.id + '/logs',
      name : 'errors',
      contentType : 'application/json',
      title : 'Error Logs'
    });
  }

  return links;
}

Bip.entityName = 'bip';
Bip.entitySchema = {
  id: {
    type: String,
    index: true,
    renderable: true,
    writable: false
  },
  name: {
    type: String,
    renderable: true,
    writable: true,
    validate : [
    {
      'validator' : BipModel.validators.max_64,
      'msg' : "64 characters max"
    }
    ]
  },
  domain_id: {
    type: String,
    index : true,
    renderable: true,
    writable: true,
    validate : [ {
      validator : function(val, next) {
        //next(true);
        //return;
        // @todo fix domain validator
        var accountInfo = this.getAccountInfo();
        if ('trigger' === this.type) {
          next(true);

        } else {
          accountInfo.testDomain(val, function(err, ok) {
            next(!err && ok);
          });
        }
      },
      msg : 'Domain Not Found'
    }
    ]
  },
  type: {
    type: String,
    renderable: true,
    writable: true,
    validate : [
    {
      validator : function(val, next) {
        if (CFG.server.smtp_bips) {
          next( /^(smtp|http|trigger)$/i.test(val) );
        } else {
          next( /^(http|trigger)$/i.test(val) );
        }
      },
      msg : 'Unexpected Bip Type'
    }
    ],
    set : function(type) {
      // empty name? then generate one
      if (undefined == this.name || this.name == '') {
        var uuidInt = new Date().getTime();
        // change base
        this.name = baseConverter.decToGeneric(uuidInt, generate_random_base());
      }

      // scrub name
      if ('smtp' === type) {
        this.name = this.name.replace(/\s/g, '-');
        this.name = this.name.replace(/[^a-zA-Z0-9-_.]/g, '');
      } else if ('http' === type) {
        this.name = this.name.replace(/[^a-zA-Z0-9-_.\s()!*+,;\[\]@]/g, '');
      }
      return type;
    }
  },
  config: {
    type: Object,
    renderable: true,
    writable: true,
    "default" : {},
    validate : [{
      validator : function(val, next) {
        var ok = false,
          self = this;

        if (!val) {
          next(ok);
          return;
        }

        // ------------------------------
        if (this.type == 'trigger') {
          ok = false;
          var cid = val.channel_id,
            accountInfo = this.getAccountInfo(),
            channel, podTokens, pod;

          if (app.helper.getRegUUID().test(cid)) {
            accountInfo.getChannel(cid, function(err, channel) {
              if (err || !channel) {
                next(false);
              } else {

                podTokens = channel.action.split('.');
                pod = self.getDao().pod(podTokens[0], accountInfo);

                ok = channel && pod && pod.isTrigger(podTokens[1]);

                next(ok);
              }
            })

          } else {
            podTokens = cid.split('.');

            pod = this.getDao().pod(podTokens[0], accountInfo);

            if (pod) {
              ok = pod.isTrigger(podTokens[1])
            }
            next(ok);
          }

        // ------------------------------
      } else if (this.type == 'http') {

        if (val.auth && /^(none|token|basic)$/.test(val.auth)) {
          if (val.auth == 'basic') {
            ok = val.username && val.password;
          } else {
            // none and token don't require extra config
            ok = true;
          }
        }

        if (val.exports && app.helper.isArray(val.exports)) {
          ok = true;
          for (var i = 0; i < val.exports.length; i++) {
            // @todo make sure inputs has been sanitized
            ok = (val.exports[i] != '' && app.helper.isString(val.exports[i]));
            if (!ok) {
              break;
            }
          }
        } else if (!val.exports) {
          ok = true;
        }

        next(ok);
        // ------------------------------
      } else if (this.type == 'smtp') {
        ok = true;
        next(ok);
      }

    },
    msg : 'Bad Config'
  },
  {
    validator : function(val, next) {
      if (this.type == 'http' && val.renderer) {
        this.getDao().validateRPC(
          val,
          this.getAccountInfo(),
          function(err, ok) {
            next(!err && ok)
          }
        );
      } else {
        next(true);
      }
    },
    msg : 'Renderer RPC Not Found'
  }
  ]
},
hub: {
  type: Object,
  renderable: true,
  writable: true,
  set : function(hub) {
    var newSrc, newCid;

      // normalize
      for (var src in hub) {

        newSrc = escapeDot(src);
        hub[newSrc] = hub[src];

        if (newSrc !== src) {
          delete hub[src];
        }

        if ( hub.hasOwnProperty(newSrc) ) {
          for (var cid in hub[newSrc].transforms) {
            newCid = escapeDot(cid);
            hub[newSrc].transforms[newCid] = hub[newSrc].transforms[cid];
            if (newCid !== cid) {
              delete hub[newSrc].transforms[cid];
            }
          }
        }
      }

      // parse
      for (var src in hub) {
        if (hub.hasOwnProperty(src)) {

          for (var cid in hub[src].transforms) {
            if (hub[src].transforms.hasOwnProperty(cid)) {
              for (var k in hub[src].transforms[cid]) {
                hub[src].transforms[cid][k] = hub[src].transforms[cid][k].trim();
              }
            }
          }

          if (hub[src].exports && app.helper.isObject(hub[src].exports)) {
            hub[src].exports = JSON.stringify(hub[src].exports);
          }

        }
      }

      return hub;
    },
    customGetter : function(hub) {
      var newSrc, newCid;

      // normalize
      for (var src in hub) {

        newSrc = unEscapeDot(src);
        hub[newSrc] = hub[src];

        if (newSrc !== src) {
          delete hub[src];
        }

        if ( hub.hasOwnProperty(newSrc) ) {
          for (var cid in hub[newSrc].transforms) {

            newCid = unEscapeDot(cid);
            hub[newSrc].transforms[newCid] = hub[newSrc].transforms[cid];
            if (newCid !== cid) {
              delete hub[newSrc].transforms[cid];
            }
          }

          if (hub[newSrc].exports && !app.helper.isObject(hub[newSrc].exports)) {
            try {
              hub[newSrc].exports = JSON.parse(hub[newSrc].exports);
            } catch (e) {
              hub[newSrc].exports = {};
            }
          }

        }
      }

      return hub;
    },
    validate : [
    {
      // not a very good validator, but will do for know.
      // @todo ensure edge > vertex > edge doesn't exist
      validator : function(hub, next) {
        var numEdges, edges = {}, edge, loop = false;
        for (key in hub) {
          edges[key] = 1;
          numEdges = hub[key].edges.length;
          for (var i = 0; i < numEdges; i++ ) {
            edge = hub[key].edges[i];

            if (!edges[edge]) {
              edges[edge] = 1;
            } else {
              edges[edge]++;
              break;
            }
          }
        }

        for (edge in edges) {
          loop = edges[edge] > 2;
          if (loop) {
            break;
          }
        }

        next(!loop);
      },
      msg : "Loop Detected"
    },

    {
      // disabled
    	validator : function(val, next) {
        next(true);
        return;
        /*
        var ok = false,
          pod,
          accountInfo = this.getAccountInfo(),
          userChannels = accountInfo.user.channels,
          numEdges,
          transforms,
          hasRenderer = this.config.renderer && undefined !== this.config.renderer.channel_id;

        // check channels + transforms make sense
        if (undefined != val.source) {
          for (var cid in val) {
            if (val.hasOwnProperty(cid)) {

              numEdges = val[cid].edges.length;
              if (numEdges > 0) {
                for (var e = 0; e < numEdges; e++) {
                  ok = false;
                  if (!app.helper.getRegUUID().test(val[cid].edges[e])) {

                    var pointerDetails=val[cid].edges[e].split(".");

                    if ( pointerDetails.length >= 2 ){
                      pod = this.getDao().pod(pointerDetails[0], accountInfo);

                      if ( pod ) {

                        if ( pod.getAction(pointerDetails[1]) ){
                          ok=true;

                        } else {

                          ok=false;
                          break;
                        }

                      } else {
                        ok=false;
                        break;
                      }
                    }
                  } else if (userChannels.get(cid)) {
                    ok = true;

                  } else {
                    ok=false;
                    break;
                  }
                }
              }

              if (!ok && hasRenderer) {
                ok = true;
              }
            }

            if (!ok) {
              break;
            }

          }
        } else if (hasRenderer) {
          ok = true;
        }
        next(ok);
        */
      },
      msg : 'Invalid, Inactive or Missing Channel In Hub'
    },

    {
      // ensure hub has a source edge
      validator : function(hub, next) {
        var hasRenderer = this.config.renderer &&
        (
          undefined !== this.config.renderer.channel_id ||
          undefined !== this.config.renderer.pod
          );

        next(hub.source && hub.source.edges.length > 0 || hasRenderer);
      },
      msg : "Hub Cannot Be Empty"
    },
    /* @todo stubbed
        {
            // ensure no orphans
            validator : function(hub, next) {
                var cid,
                    k,
                    egress = {};

                for (cid in hub) {
                    if (hub.hasOwnProperty(cid)) {
                        egress[cid] = 1;
                        for (k = 0; k < hub[cid].edges.length; k++) {
                            if (undefined === egress[hub[cid].edges[k]]) {
                                egress[hub[cid].edges[k]] = 1;
                            }
                            egress[hub[cid].edges[k]]--;
                        }
                    }
                }
            },
            msg : "Orphaned Channel"
          }*/
          ]
        },
        note: {
          type: String,
          renderable: true,
          writable: true,
          "default" : '',
          validate : [{
            'validator' : BipModel.validators.max_text,
            'msg' : "1024 characters max"
          }]
        },
        end_life: {
          type: Object,
          renderable: true,
          writable: true,
          set : endLifeParse,
          validate : [{
            validator : function(val, next) {
              next(
                (parseFloat(val.imp) == parseInt(val.imp)) && !isNaN(val.imp) &&
                ((parseFloat(val.time) == parseInt(val.time)) && !isNaN(val.time)) ||
                0 !== new Date(Date.parse(val.time)).getTime()
                );
            },
            msg : 'Bad Expiry Structure'
          },
          {
            validator : function(val, next) {
              next(val.action && /^(pause|delete)$/i.test(val.action) );
            },
            msg : 'Expected "pause" or "delete"'
          }
          ]
        },
        paused: {
          type: Boolean,
          renderable: true,
          writable: true,
          'default' : false,
          set : function(newValue) {
            return newValue;
    /*
            if (false === this.paused && newValue) {
                Bip.getDao().pauseBip(this, null, newValue, null);
            }
            return newValue;
            */
          },
          validate : [{
            'validator' : BipModel.validators.bool_any,
            'msg' : 'Expected 1,0,true,false'
          }]
        },
        schedule: {
          type: Object,
          renderable: true,
          writable: true,
          default : {},
          set : setSchedule
        },
        binder: {
          type: Array,
          renderable: true,
          writable: true
        },
        icon : {
          type: String,
          renderable: true,
          writable: true,
          "default" : ""
        },
        app_id : {
          type: String,
          renderable: true,
          writable: true,
          "default" : ""
        },
        owner_id : {
          type: String,
          index: true,
          renderable: false,
          writable: false
        },
        created : {
          type: Number,
          renderable: true,
          writable: false
        },
        _imp_actual : {
          type : Number,
          renderable : true,
          writable : false,
          "default" : 0
        },
        _last_run : {
          type : Number,
          renderable : true,
          writable : false,
          "default" : 0,
          get : function(value) {
            if (value) {
              var now = app.moment.utc();
              return app.moment.duration(now.diff(value)).humanize() + ' ago';
            } else {
              return '';
            }
          },
          getLastRun : function(value) {
            if (value) {
             var now = app.moment.utc();
             return value;
           } else {
             return '';
           }
         }
       },
  exports : { // user timezone
    type : Object,
    renderable : true,
    writable : true,
    get : function(val) {
      return val ? JSON.parse(val) : val;
    },
    set : function(val) {
      return val ? JSON.stringify(val) : val;
    }
  },

  // channel secondary index
  _channel_idx : {
    type : Array,
    renderable : true,
    writable : false
  },
  _errors : {
    type : Boolean,
    renderable : false,
    writable : false
  }
};

Bip.compoundKeyConstraints = {
  owner_id : 1,
  name : 1,
  type : 1
};

Bip.exports = {
  getExports : function(type, keysOnly) {
    var exp = [];

    if (this[type]) {
      if (keysOnly && true == keysOnly) {
        exp = [];
        for (key in this[type]) {
          exp.push(key);
        }
        // register available client exports for the bip
        exp.push('_client#host');
      } else {
        exp = this[type];
        exp['_client#host'] = {
          type : 'string'
        }
      }

      // HTTP Bips can be configured with export hints depending on
      // what the end user needs to send.  We assume they're strings.
      //
      if (this.type == 'http' && this.config.exports.length > 0) {
       for (var i = 0; i < this.config.exports.length; i++) {
        exp[this.config.exports[i]] = {
          type : String,
          description : this.config.exports[i]
        }
      }
    }

  }
  return exp;
},

'*' : {
  properties : {
      '_files' : { // tba
        type : 'array',
        description : 'File Objects'
      },
      '_client' : {
        type : 'object',
        description : 'Client Info',
        properties : {
          "host" : {
            "title" : "Host",
            "type" : "string"
          },
          "repr" : {
            "title" : "Sender",
            "type" : "string"
          },
          "date" : {
            "title" : "Invoke Time",
            "type" : "string"
          },
          "id" : {
            "title" : "Message ID",
            "type" : "string"
          },
          "proto" : {
            "title" : "Protocol",
            "type" : "string"
          },
          "method" : {
            "title" : "Request Method",
            "type" : "string"
          }
        }
      },
      '_bip' : {
        type : 'object',
        description : 'This Bip',
        properties : {
          "name" : {
            "title" : "Name",
            "type" : "string"
          },
          "type" : {
            "title" : "Type",
            "type" : "string"
          },
          "note" : {
            "title" : "Description",
            "type" : "string"
          },
          "_repr" : {
            "title" : "Link",
            "type" : "string"
          }
        }
      }
    }
  },

  // http export helpers
  'http' : {
    title : 'Incoming Web Hook',
    type : 'object',
    properties : {
      'title' : {
        type : 'string',
        description: 'Message Title'
      },

      'body' : {
        type : 'string',
        description: 'Message Body'
      },
      'rawBody' : {
        type : 'string',
        description: 'Raw Body'
      }
    },
    definitions : {
    }
  },

  'trigger' : {
    properties : {},
    definitions : {}
  }
}

if (CFG.server.smtp_bips) {
  Bip.exports.smtp = {
    title : 'Incoming Email',
    type : 'object',
    properties : {
      'subject' : {
        type : 'string',
        description: 'Message Subject'
      },

      'body_text' : {
        type : 'string',
        description: 'Text Message Body'
      },

      'body_html' : {
        type : 'string',
        description: 'HTML Message Body'
      },

      'reply_to' : {
        type : 'string',
        description: 'Sender'
      },
      'headers' : {
        type : 'object',
        description : 'Headers',
        properties : {
          'from' : {
            type : 'string',
            description : 'From'
          },
          'to' : {
            type : 'string',
            description : 'To'
          },
          'subject' : {
            type : 'string',
            description : 'Subject'
          },
          'date' : {
            type : 'string',
            description : 'Date'
          },
          'message-id' : {
            type : 'string',
            description : 'Message ID'
          },
          'bcc' : {
            type : 'string',
            description : 'Bcc'
          },
          'cc' : {
            type : 'string',
            description : 'Cc'
          },
          'content-type' : {
            type : 'string',
            description : 'Content Type'
          },
          'in-reply-to' : {
            type : 'string',
            description : 'In Reply To'
          },
          'precedence' : {
            type : 'string',
            description : 'Precedence'
          },
          'received' : {
            type : 'string',
            description : 'Received'
          },
          'references' : {
            type : 'string',
            description : 'References'
          },
          'reply-to' : {
            type : 'string',
            description : 'Reply To'
          },
          'sender' : {
            type : 'string',
            description : 'Sender'
          },
          'return-path' : {
            type : 'string',
            description : 'Return Path'
          },
          'error-to' : {
            type : 'string',
            description : 'Error To'
          }
        }
      },
      headers_raw : {
        type : 'string',
        description : 'Raw Headers'
      }
    },
    definitions : {
    }
  };
}

Bip._createChannelIndex = function() {
  // create channel index
  var channels = [];
  if (this.config && this.config.channel_id && '' !== this.config.channel_id) {
    channels.push(this.config.channel_id);
  }

  for (var k in this.hub) {
    if (this.hub.hasOwnProperty(k)) {
      if (this.hub[k].edges) {
        channels = channels.concat(this.hub[k].edges);
      }
    }
  }

  if (this.config && 'http' === this.type && app.helper.isObject(this.config.renderer)
    && this.config.renderer.channel_id
    && this.config.renderer.renderer) {
    channels.push(this.config.renderer.channel_id);
  }

  this._channel_idx = app._.uniq(channels);
}

/**
 * For any omitted attributes, use account defaults
 */
 Bip.preSave = function(accountInfo, next) {
  var self = this;

  accountInfo.getSettings(
    function(err, settings) {

      if ('' !== self.id && undefined !== self.id) {
        var props = {
          'domain_id' : settings["bip_domain_id"],
          'type' :  settings["bip_type"],
          'anonymize' :  settings["bip_anonymize"],
          'config' :  settings["bip_config"],
          'end_life' :  settings["bip_end_life"],
          'hub' :  settings["bip_hub"],
          'icon' : ''
        };

        app.helper.copyProperties(props, self, false);
      }

      if (!self.end_life.action || '' === self.end_life.action) {
        self.end_life.action = settings["bip_expire_behaviour"];
      }

      if (self.domain_id === '') {
        self.domain_id = undefined;
      }

      var transformUnpack = [], ptr;

      // translate 'default' transforms
      for (cid in self.hub) {
        if (self.hub.hasOwnProperty(cid)) {
          if (self.hub[cid].transforms) {
            for (edgeCid in self.hub[cid].transforms) {
              if ('default' === self.hub[cid].transforms[edgeCid]) {
                self.hub[cid].transforms[edgeCid] = {};
                transformUnpack.push(
                  (function(accountInfo, from, to, ptr) {
                    return function(cb) {
                      self._dao.getTransformHint(accountInfo, from, to, function(err, modelName, result) {
                        if (!err && result && result.transform) {
                          app.helper.copyProperties(result.transform, ptr, true);
                        }

                        cb(err);
                      });
                    }
                  })(accountInfo,
                  'bip.' + self.type,
                  accountInfo.user.channels.get(edgeCid).action,
                  self.hub[cid].transforms[edgeCid])
                );
              }
            }
          }
        }
      }

      self._createChannelIndex();

      if (transformUnpack.length > 0) {
        async.parallel(transformUnpack, function(err) {
          next(err, self);
        });
      } else {
        next(false, self);
      }
    }
  );
};

function getAction(accountInfo, channelId) {
  return accountInfo.user.channels.get(channelId).action;
}

Bip.normalizeTransformDefaults = function(accountInfo, next) {
// disabled until bip-508 complete
next({});
return;
  var from, to, payload, fromMatch, transforms = {}, dirty = false,
  hub = JSON.parse(JSON.stringify(this.hub));

  for (var key in hub) {
    if (hub.hasOwnProperty(key)) {
      fromMatch = new RegExp(key, 'gi');
      if (key === 'source') {
        if (this.type === 'trigger' && this.config.channel_id) {
          from = getAction(accountInfo, this.config.channel_id);
        } else {
          from = 'bip.' + this.type;
        }
      } else {
        from = getAction(accountInfo, key);
      }

      if (hub[key].transforms && Object.keys(hub[key].transforms).length > 0) {
        for (var txChannelId in this.hub[key].transforms) {
          if (hub[key].transforms.hasOwnProperty(txChannelId)) {
        		var res=app.helper.getRegUUID().test(txChannelId);
        		if(!res){
        			//remove the verison from the pointer example facebook.post_page._0, then it should just return facebook.post_page
        			var tmp=txChannelId.split(".");
        			tmp.pop();
        			txChannelId=tmp.join(".");
        		}
            to = getAction(accountInfo, txChannelId);
            if (from && to) {

			  // filter to include only transforms for these
              // adjacent channels
              for(var txKey in hub[key].transforms[txChannelId]) {

                if (hub[key].transforms[txChannelId].hasOwnProperty(txKey)) {

                  hub[key].transforms[txChannelId][txKey].replace(fromMatch, from);

                  if (app.helper.getRegUUID().test(hub[key].transforms[txChannelId][txKey])) {
                    hub[key].transforms[txChannelId][txKey] = '';
                  }

                  // strip any remaining uuid's.  Only supporting adjacent transform helpers
                  // for now
                  hub[key].transforms[txChannelId][txKey].replace(app.helper.getRegActionUUID(), '');
                }
              }

              // default transform payload
              payload = {
                from_channel : from,
                to_channel : to,
                transform : hub[key].transforms[txChannelId],
                owner_id : accountInfo.user.id
              };
              next(payload);
            }
          }
        }
      }
    }
  }
}

Bip.preRemove = function(id, accountInfo, next) {
  var self = this;

  this._dao.removeBipDeltaTracking(id, function(err) {
    if (err) {
      next(err, 'bip', self);
    } else {
      self._dao.removeBipDupTracking(id, function(err) {
        next(err, 'bip', self);

        accountInfo.bip = self;

        self._postRemoveChannels(accountInfo);

      });
    }
  });
}

Bip._postRemoveChannels = function(accountInfo) {
  var self = this;

  for (var i = 0; i < this._channel_idx.length; i++) {
    self._dao.getChannel(
      this._channel_idx[i],
      accountInfo,
      function(err, channel) {
        // only call postRemove for action pointers
        if (!err && channel && !app.helper.getRegUUID().test(channel.id)) {
          self._dao.modelFactory('channel', channel).postRemove(
            channel.id,
            accountInfo,
            function() {}
          );
        }
      },
      this.config && this.config.channel_id && this.config.channel_id === this._channel_idx[i]
        ? this.config.config
        : null
    );
  }
}

Bip._postSaveChannels = function(accountInfo, isNew) {
  var self = this;

  for (var i = 0; i < this._channel_idx.length; i++) {
    self._dao.getChannel(
      this._channel_idx[i],
      accountInfo.getId(),
      function(err, channel) {
        // only call postSave for action pointers
        if (!err && channel && !app.helper.getRegUUID().test(channel.id)) {
          self._dao.modelFactory('channel', channel).postSave(
            accountInfo,
            function(err) {
              if (err) {
                err = app.helper.isObject(err) ? JSON.stringify(err) : err;
                // if channel has propgated an error, then add it to this bips error log
                app.bastion.createJob(DEFS.JOB_BIP_ACTIVITY, {
                  owner_id : self.owner_id,
                  bip_id : self.id,
                  code : 'bip_channnel_error',
                  message : err,
                  source : channel.id
                });
              }
            },
            isNew
          );
        }
      },
      this.config && this.config.channel_id && this.config.channel_id === this._channel_idx[i]
        ? this.config.config
        : null
    );
  }
}

Bip.postSave = function(accountInfo, next, isNew) {
  var self = this;

  this.normalizeTransformDefaults(accountInfo, function(payload) {
    if (payload.transform && Object.keys(payload.transform).length > 0) {
      app.bastion.createJob(DEFS.JOB_BIP_SET_DEFAULTS, payload);
    }
  });

  // create metric updates jobs
  if (isNew) {
    app.bastion.createJob(DEFS.JOB_USER_STAT, {
      owner_id : accountInfo.user.id,
      type : 'bips_total'
    } );
    app.bastion.createJob(DEFS.JOB_BIP_ACTIVITY, {
      bip_id : this.id,
      owner_id : accountInfo.user.id,
      code : 'bip_create'
    } );

    // if its a new trigger, then run it
    if ('trigger' === this.type && !this.paused) {
      this._dao.triggerAll(function() {}, { id : this.id }, false, false, true);
    }
  }

  next(false, this.getEntityName(), this);

  accountInfo.bip = this;

  this._postSaveChannels(accountInfo, isNew);
};


// ensure we have an up to date channel index
Bip.prePatch = function(patch, accountInfo, next) {
  var self = this;

  for (var k in patch) {
    if (patch.hasOwnProperty(k)) {
      if (Bip.entitySchema[k].set) {
        patch[k] = Bip.entitySchema[k].set(patch[k]);
      }

      this[k] = patch[k];
    }
  }
  this._createChannelIndex();

  patch._channel_idx = this._channel_idx;

  next(false, this.getEntityName(), patch);

  accountInfo.bip = this;

  this._postSaveChannels(accountInfo);
};


Bip.isScheduled = function( next) {
	var accountInfo = this.getAccountInfo();

  var timeNow = new Date();

	// check if the set schedule dictates that it is time to trigger this bip
	if (this.schedule && this.schedule.nextTimeToRun) {
		if (timeNow.getTime() >= this.schedule.nextTimeToRun) {
			next(true);
		} else {
			next(false);
		}
	} else {
		(this.schedule) ? next(false) : next(true); // legacy bips without schedule.
	}
}

Bip.hasSchedule = function() {
	return this.schedule !== undefined;
}

Bip.getNextScheduledRunTime = function(options) {
	var options = options || this.schedule.sched;
	var recur = Rrecur.create(options, new Date(), this.schedule.timeZone.offset);
	var nextRecurrence = moment(recur.next()).unix() * 1000;
	return nextRecurrence;
}


Bip.checkExpiry = function(next) {
  var accountInfo = this.getAccountInfo(),
    self = this;

  accountInfo.getSettings(
    function(err, settings) {
      if (self.end_life) {

        // convert bip expiry to user timezone
        var endTime = (app.moment(self.end_life.time).utc() ) + (app.moment().utcOffset() * 60),
        nowTime = app.helper.nowTimeTz(settings.timezone),
        endImp =  parseInt(self.end_life.imp * 1),
        expired = false;

        if (endTime > 0) {
          // if its an integer, then treat as a timestamp
          if (!isNaN(endTime)) {
            // expired? then pause
            if (nowTime >= endTime) {
              // pause this bip
              expired = true;
            }
          }
        }

        if (endImp > 0) {
          if (self._imp_actual && self._imp_actual >= endImp) {
            expired = true;
          }
        }
      }

      next(expired);
    }
  );
};

Bip.expire = function(transactionId, next) {
  var accountInfo = this.getAccountInfo(),
  expireBehavior = (this.end_life.action && '' !== this.end_life.action)
  ? this.end_life.action
  : accountInfo.user.settings.bip_expire_behaviour;

  if ('delete' === expireBehavior) {
    this._dao.deleteBip(this, accountInfo, next, transactionId);
  } else {
    this._dao.pauseBip(this, true, next, transactionId);
  }
}

// returns the transforms for an edge, if any are present
Bip.getTransformFor = function(cid) {
  var transforms = app._.pluck(this.hub, 'transforms');

  for (var i = 0; i < transforms.length; i++) {
    if (transforms[i] && transforms[i][cid]) {
      return transforms[i][cid];
    }
  }

  return;
}

module.exports.Bip = Bip;
